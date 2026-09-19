import { describe, expect, it } from "vitest";
import { evaluatePromotion, parseStatement, statementsConflict } from "../src/index.js";
import { mem } from "./helpers.js";

describe("deduplication", () => {
  it("merges paraphrases of the same fact and preserves provenance", async () => {
    const m = await mem({ project: "p" });
    const e1 = await m.addEvent({
      kind: "message",
      role: "user",
      content: "payroll uses temporal",
    });
    const e2 = await m.addEvent({
      kind: "message",
      role: "user",
      content: "payroll generation uses temporal",
    });
    const e3 = await m.addEvent({
      kind: "message",
      role: "user",
      content: "temporal is used for payroll",
    });
    const a = await m.remember({ content: "Payroll uses Temporal.", sourceIds: [e1.id] });
    const b = await m.remember({
      content: "Payroll generation uses Temporal.",
      sourceIds: [e2.id],
    });
    const c = await m.remember({ content: "Temporal is used for payroll.", sourceIds: [e3.id] });
    expect(a.action).toBe("created");
    expect(b.action).toBe("merged");
    expect(c.action).toBe("merged");
    expect(b.memory.id).toBe(a.memory.id);
    expect(await m.count()).toBe(1);
    const insp = await m.inspect(a.memory.id);
    expect(insp.sources.map((e) => e.id).sort()).toEqual([e1.id, e2.id, e3.id].sort());
    expect(insp.memory.metadata.mergeCount).toBe(2);
    expect(insp.memory.metadata.aliases).toContain("Temporal is used for payroll.");
    expect(insp.history.map((h) => h.action)).toEqual(["created", "merged", "merged"]);
    await m.close();
  });

  it("does not merge different facts", async () => {
    const m = await mem({ project: "p" });
    await m.remember({ content: "Payroll uses Temporal." });
    const r = await m.remember({ content: "Authentication uses OAuth with PKCE." });
    expect(r.action).toBe("created");
    expect(await m.count()).toBe(2);
    await m.close();
  });

  it("force bypasses dedup", async () => {
    const m = await mem({ project: "p" });
    await m.remember({ content: "Payroll uses Temporal." });
    const r = await m.remember({ content: "Payroll uses Temporal.", force: true });
    expect(r.action).toBe("created");
    expect(await m.count()).toBe(2);
    await m.close();
  });
});

describe("conflict detection", () => {
  it("parses subject/predicate/object statements", () => {
    expect(parseStatement("Database = MySQL")).toMatchObject({
      subject: "database",
      predicate: "is",
    });
    expect(parseStatement("The primary database is PostgreSQL")?.predicate).toBe("is");
    expect(statementsConflict("Database = MySQL", "Database = PostgreSQL")).toBe(true);
    expect(statementsConflict("Payroll uses Temporal", "Payroll uses Stripe")).toBe(true);
    expect(statementsConflict("Payroll uses Temporal", "Payroll uses Temporal workflows")).toBe(
      false,
    );
    expect(statementsConflict("Payroll uses Temporal", "Billing uses Stripe")).toBe(false);
  });

  it("supersedes the old value instead of overwriting it", async () => {
    const m = await mem({ project: "p" });
    const old = await m.remember({ content: "Database = MySQL", type: "architecture" });
    const fresh = await m.remember({ content: "Database = PostgreSQL", type: "architecture" });
    expect(fresh.action).toBe("superseded");
    expect(fresh.relatedId).toBe(old.memory.id);
    const oldNow = await m.get(old.memory.id);
    expect(oldNow.status).toBe("superseded");
    expect(oldNow.supersededBy).toBe(fresh.memory.id);
    expect(fresh.memory.supersedes).toBe(old.memory.id);
    // superseded memories are hidden from default search but still inspectable
    const results = await m.search({ query: "database" });
    expect(results.map((r) => r.memory.id)).toEqual([fresh.memory.id]);
    const insp = await m.inspect(fresh.memory.id);
    expect(insp.supersedes?.content).toBe("Database = MySQL");
    expect((await m.list({ status: "superseded" })).map((x) => x.id)).toEqual([old.memory.id]);
    await m.close();
  });

  it("flags both memories when policy is flag, and can be resolved", async () => {
    const m = await mem({ project: "p", memory: { conflicts: { policy: "flag" } } });
    const old = await m.remember({ content: "Payroll uses Temporal" });
    const fresh = await m.remember({ content: "Payroll uses Stripe" });
    expect(fresh.action).toBe("conflicted");
    expect((await m.get(old.memory.id)).status).toBe("conflicted");
    expect((await m.get(fresh.memory.id)).status).toBe("conflicted");
    expect((await m.search({ query: "payroll" })).length).toBe(2); // conflicted still visible
    await m.resolveConflict(fresh.memory.id, old.memory.id);
    expect((await m.get(fresh.memory.id)).status).toBe("active");
    expect((await m.get(old.memory.id)).status).toBe("superseded");
    await m.close();
  });

  it("detects negation conflicts", async () => {
    const m = await mem({ project: "p" });
    await m.remember({ content: "The API uses GraphQL." });
    const r = await m.remember({ content: "The API does not use GraphQL." });
    expect(r.action).toBe("superseded");
    await m.close();
  });
});

describe("promotion", () => {
  it("promotes repeated, important, confident facts to core", async () => {
    const m = await mem({ project: "p" });
    const first = await m.remember({
      content: "Payroll uses Temporal.",
      importance: 0.8,
      confidence: 0.9,
    });
    expect(first.memory.level).toBe("atomic");
    await m.remember({
      content: "Payroll generation uses Temporal.",
      importance: 0.8,
      confidence: 0.9,
    });
    const third = await m.remember({
      content: "Temporal is used for payroll.",
      importance: 0.8,
      confidence: 0.9,
    });
    expect(third.memory.level).toBe("core");
    expect((await m.inspect(third.memory.id)).history.some((h) => h.action === "promoted")).toBe(
      true,
    );
    await m.close();
  });

  it("does not promote unimportant or session memories", async () => {
    const m = await mem({ project: "p" });
    for (const c of [
      "Payroll uses Temporal.",
      "Payroll generation uses Temporal.",
      "Temporal is used for payroll.",
    ]) {
      await m.remember({ content: c, importance: 0.2 });
    }
    expect((await m.list())[0]!.level).toBe("atomic");
    const ev = evaluatePromotion(
      { ...(await m.list())[0]!, scope: "session", importance: 0.9 },
      m.config.memory.promotion,
    );
    expect(ev.eligible).toBe(false);
    expect(ev.reasons.join()).toMatch(/session/);
    await m.close();
  });

  it("supports manual promote/demote and consolidation", async () => {
    const m = await mem({ project: "p", memory: { autoPromotion: false } });
    const a = await m.remember({
      content: "All tracing uses W3C traceparent.",
      importance: 0.9,
      confidence: 0.95,
    });
    expect((await m.promote(a.memory.id)).level).toBe("core");
    expect((await m.demote(a.memory.id)).level).toBe("atomic");
    await m.remember({ content: "Tracing uses W3C traceparent." });
    await m.remember({ content: "W3C traceparent is used for tracing." });
    const before = await m.get(a.memory.id);
    expect(before.level).toBe("atomic");
    m.config.memory.autoPromotion = true;
    const result = await m.consolidate();
    expect(result.promoted).toContain(a.memory.id);
    await m.close();
  });
});

describe("expiration", () => {
  it("hides expired memories and archives them on consolidate", async () => {
    const m = await mem({ project: "p" });
    const r = await m.remember({ content: "Temporary note about the current sprint.", ttlMs: 1 });
    await new Promise((res) => setTimeout(res, 5));
    expect(await m.count()).toBe(0);
    expect(await m.count({ includeExpired: true })).toBe(1);
    expect((await m.search({ query: "sprint" })).length).toBe(0);
    const c = await m.consolidate();
    expect(c.expired).toEqual([r.memory.id]);
    expect((await m.get(r.memory.id)).status).toBe("archived");
    await m.close();
  });

  it("session-scoped memories get a default TTL", async () => {
    const m = await mem({ project: "p" });
    const r = await m.remember({
      content: "Working on the login bug",
      scope: "session",
      sessionId: "s1",
    });
    expect(r.memory.expiresAt).toBeInstanceOf(Date);
    expect(r.memory.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    await m.close();
  });
});

describe("update and forget", () => {
  it("updates fields, re-hashes content and records history", async () => {
    const m = await mem({ project: "p" });
    const r = await m.remember({
      content: "Use PostgreSQL JSONB for policy metadata.",
      type: "architecture",
    });
    const u = await m.update(r.memory.id.slice(0, 8), {
      content: "Use PostgreSQL JSONB for policy metadata and audit logs.",
      importance: 0.95,
      tags: ["db"],
    });
    expect(u.content).toContain("audit logs");
    expect(u.importance).toBe(0.95);
    expect(u.contentHash).not.toBe(r.memory.contentHash);
    expect((await m.inspect(u.id)).history.at(-1)?.action).toBe("updated");
    await m.close();
  });

  it("forget deletes the memory but keeps raw events; archive keeps the row", async () => {
    const m = await mem({ project: "p" });
    const e = await m.addEvent({ kind: "message", role: "user", content: "raw" });
    const a = await m.remember({ content: "Fact A to delete", sourceIds: [e.id] });
    const b = await m.remember({ content: "Fact B to archive" });
    await m.forget(a.memory.id);
    await expect(m.get(a.memory.id)).rejects.toThrow(/not found/i);
    expect(await m.getEvent(e.id)).not.toBeNull();
    await m.forget(b.memory.id, { archive: true });
    expect((await m.get(b.memory.id)).status).toBe("archived");
    expect(await m.count()).toBe(0);
    await m.close();
  });

  it("rejects empty content and ambiguous ids with helpful errors", async () => {
    const m = await mem();
    await expect(m.remember({ content: "   " })).rejects.toThrow(/must not be empty/);
    await expect(m.get("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await m.close();
  });
});
