import { describe, expect, it } from "vitest";
import { mem } from "./helpers.js";

describe("scopes and project isolation", () => {
  it("does not leak project A memories into project B", async () => {
    const m = await mem();
    await m.remember({ content: "Project A uses Temporal for payroll.", projectId: "project-a" });
    await m.remember({ content: "Project B uses Stripe for payroll.", projectId: "project-b" });
    await m.remember({ content: "I prefer PostgreSQL for payroll databases.", scope: "user" });

    const a = await m.search({ query: "payroll", projectId: "project-a" });
    expect(a.map((r) => r.memory.projectId ?? "user").sort()).toEqual(["project-a", "user"]);

    const b = await m.list({ projectId: "project-b" });
    expect(b.map((x) => x.projectId ?? "user").sort()).toEqual(["project-b", "user"]);

    // no project: only global/user memories
    const none = await m.search({ query: "payroll" });
    expect(none).toHaveLength(1);
    expect(none[0]!.memory.scope).toBe("user");

    // explicit opt-in to see everything
    expect(await m.count({ allProjects: true })).toBe(3);
    await m.close();
  });

  it("uses the configured project by default and ranks project memories higher", async () => {
    const m = await mem({ project: "my-app" });
    await m.remember({
      content: "Database architecture uses PostgreSQL with JSONB.",
      scope: "user",
    });
    const proj = await m.remember({
      content: "Database architecture: PostgreSQL 16 with pgvector.",
    });
    expect(proj.memory.projectId).toBe("my-app");
    expect(proj.memory.scope).toBe("project");
    const r = await m.recall({ query: "database architecture" });
    expect(r[0]!.memory.id).toBe(proj.memory.id);
    expect(r[0]!.explanation).toContain("project match");
    await m.close();
  });

  it("falls back to user scope when no project is available", async () => {
    const m = await mem();
    const r = await m.remember({ content: "No project here." });
    expect(r.memory.scope).toBe("user");
    expect(r.memory.projectId).toBeUndefined();
    await m.close();
  });

  it("dedup never merges across projects", async () => {
    const m = await mem();
    await m.remember({ content: "Payroll uses Temporal.", projectId: "a" });
    const r = await m.remember({ content: "Payroll uses Temporal.", projectId: "b" });
    expect(r.action).toBe("created");
    expect(await m.count({ allProjects: true })).toBe(2);
    await m.close();
  });

  it("auto-creates project rows", async () => {
    const m = await mem();
    await m.remember({ content: "hello", projectId: "auto-proj" });
    expect((await m.listProjects()).map((p) => p.name)).toEqual(["auto-proj"]);
    await m.close();
  });
});
