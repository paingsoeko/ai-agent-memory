import { describe, expect, it } from "vitest";
import { SQLiteStore, contentHash } from "../src/index.js";

async function store() {
  return SQLiteStore.open({ path: ":memory:" });
}

function record(content: string, extra: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    content,
    type: "fact",
    level: "atomic" as const,
    scope: "user" as const,
    status: "active" as const,
    confidence: 0.8,
    importance: 0.5,
    sourceIds: [],
    tags: [],
    contentHash: contentHash(content),
    sensitive: false,
    metadata: {},
    ...extra,
  };
}

describe("SQLiteStore", () => {
  it("creates, reads, updates and deletes memories", async () => {
    const s = await store();
    const m = await s.createMemory(record("PostgreSQL is the primary database", { tags: ["db"] }));
    expect(m.id).toBeTruthy();
    expect(await s.getMemory(m.id)).toMatchObject({
      content: "PostgreSQL is the primary database",
      tags: ["db"],
    });
    const u = await s.updateMemory(m.id, { importance: 0.9, tags: ["db", "infra"] });
    expect(u.importance).toBe(0.9);
    expect(u.tags).toEqual(["db", "infra"]);
    expect(u.updatedAt.getTime()).toBeGreaterThanOrEqual(m.updatedAt.getTime());
    await s.deleteMemory(m.id);
    expect(await s.getMemory(m.id)).toBeNull();
    await expect(s.deleteMemory(m.id)).rejects.toThrow(/not found/);
    await s.close();
  });

  it("rolls back transactions on error", async () => {
    const s = await store();
    await expect(
      s.transaction(async () => {
        await s.createMemory(record("inside tx"));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await s.count({ allProjects: true })).toBe(0);
    // nested savepoint rollback keeps the outer work
    await s.transaction(async () => {
      await s.createMemory(record("outer"));
      await s
        .transaction(async () => {
          await s.createMemory(record("inner"));
          throw new Error("inner boom");
        })
        .catch(() => undefined);
    });
    const all = await s.list({ allProjects: true });
    expect(all.map((m) => m.content)).toEqual(["outer"]);
    await s.close();
  });

  it("stores events, sources and scenes with cascade", async () => {
    const s = await store();
    const [e1, e2] = await s.createEvents([
      { kind: "message", role: "user", content: "we use temporal" },
      { kind: "message", role: "assistant", content: "ok" },
    ]);
    expect(await s.countEvents()).toBe(2);
    const m = await s.createMemory(
      record("Payroll uses Temporal", { sourceIds: [e1!.id, e2!.id] }),
    );
    expect((await s.getSources(m.id)).map((e) => e.id).sort()).toEqual([e1!.id, e2!.id].sort());
    expect((await s.getMemoriesForEvent(e1!.id)).map((x) => x.id)).toEqual([m.id]);
    const scene = await s.createScene({
      name: "Payroll",
      memoryIds: [m.id],
      keywords: ["payroll"],
    });
    expect((await s.getScenesForMemory(m.id)).map((x) => x.name)).toEqual(["Payroll"]);
    await s.deleteMemory(m.id);
    expect((await s.getScene(scene.id))!.memoryIds).toEqual([]);
    // events survive memory deletion (provenance is never destroyed)
    expect(await s.countEvents()).toBe(2);
    await s.close();
  });

  it("paginates and orders lists", async () => {
    const s = await store();
    for (let i = 0; i < 25; i++)
      await s.createMemory(record(`memory number ${i}`, { importance: i / 25 }));
    const page1 = await s.list({
      allProjects: true,
      limit: 10,
      orderBy: "importance",
      order: "desc",
    });
    const page2 = await s.list({
      allProjects: true,
      limit: 10,
      offset: 10,
      orderBy: "importance",
      order: "desc",
    });
    expect(page1).toHaveLength(10);
    expect(page1[0]!.content).toBe("memory number 24");
    expect(page2[0]!.content).toBe("memory number 14");
    expect(await s.count({ allProjects: true })).toBe(25);
    await s.close();
  });

  it("stores and searches embeddings without loading everything", async () => {
    const s = await store();
    const ids: string[] = [];
    for (let i = 0; i < 1500; i++) {
      const m = await s.createMemory(record(`vector memory ${i}`));
      ids.push(m.id);
      await s.setEmbedding(m.id, "test", Float32Array.from([i / 1500, 1 - i / 1500, 0.1]));
    }
    expect(await s.countEmbeddings("test")).toBe(1500);
    const hits = await s.searchVector(
      Float32Array.from([1, 0, 0]),
      "test",
      { allProjects: true },
      3,
    );
    expect(hits).toHaveLength(3);
    expect(hits[0]!.id).toBe(ids[1499]);
    expect(hits[0]!.score).toBeGreaterThan(hits[2]!.score);
    await s.close();
  });

  it("keyword search stays fast at scale (FTS scan is the outer loop)", async () => {
    const s = await store();
    const words =
      "payroll temporal workflow laravel node postgres redis auth token trace deploy test schema queue cache api billing tenant policy audit".split(
        " ",
      );
    const pick = () => words[Math.floor(Math.random() * words.length)];
    const n = 20_000;
    for (let b = 0; b < n; b += 5000) {
      await s.transaction(async () => {
        for (let i = b; i < b + 5000; i++) {
          const content = `${pick()} ${pick()} uses ${pick()} ${pick()} #${i}`;
          await s.createMemory(record(content, { projectId: `p${i % 10}`, scope: "project" }));
        }
      });
    }
    const start = performance.now();
    const hits = await s.searchKeyword("payroll temporal workflow", { allProjects: true }, 50);
    const filtered = await s.searchKeyword("payroll temporal workflow", { projectId: "p3" }, 50);
    const elapsed = performance.now() - start;
    expect(hits.length).toBe(50);
    expect(filtered.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000); // broken join order takes > 20s here
    await s.close();
  });

  it("resolves id prefixes", async () => {
    const s = await store();
    const m = await s.createMemory(record("prefix test"));
    expect(await s.resolveMemoryId(m.id.slice(0, 8))).toEqual([m.id]);
    expect(await s.resolveMemoryId("zzzz")).toEqual([]);
    await s.close();
  });

  it("upserts projects and sessions and reports stats", async () => {
    const s = await store();
    const p = await s.upsertProject({ name: "my-app", description: "HR platform" });
    expect(p.id).toBe("my-app");
    expect((await s.upsertProject({ name: "my-app", metadata: { lang: "ts" } })).metadata).toEqual({
      lang: "ts",
    });
    await s.upsertSession({ id: "sess1", projectId: p.id, agent: "claude" });
    expect((await s.getSession("sess1"))!.agent).toBe("claude");
    await s.createMemory(record("x", { projectId: p.id, scope: "project" }));
    const stats = await s.stats();
    expect(stats.memories).toBe(1);
    expect(stats.projects).toBe(1);
    expect(stats.byScope).toEqual({ project: 1 });
    await s.close();
  });

  it("persists to disk and reopens", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "aim-"));
    const path = join(dir, "nested", "memory.db");
    const a = await SQLiteStore.open({ path });
    await a.createMemory(record("persisted"));
    await a.close();
    const b = await SQLiteStore.open({ path });
    expect((await b.list({ allProjects: true })).map((m) => m.content)).toEqual(["persisted"]);
    await b.close();
  });
});
