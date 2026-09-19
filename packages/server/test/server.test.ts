import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type ApiServer } from "../src/index.js";

let srv: ApiServer;
let base: string;

async function api(path: string, init?: RequestInit) {
  const res = await fetch(base + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

beforeAll(async () => {
  srv = await startServer({
    port: 4139,
    host: "127.0.0.1",
    path: ":memory:",
    log: false,
    skipConfigFiles: true,
  });
  base = srv.url;
});

afterAll(async () => {
  await srv.close();
});

describe("memory web API", () => {
  let id = "";

  it("reports health and stats", async () => {
    expect((await api("/api/health")).body).toMatchObject({ ok: true });
    expect((await api("/api/stats")).body).toMatchObject({ memories: 0 });
  });

  it("creates, lists, searches and inspects a memory", async () => {
    const created = await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({
        content: "Payroll generation uses Temporal workflows.",
        type: "architecture",
        agent: "test",
      }),
    });
    expect(created.status).toBe(201);
    id = (created.body as { memory: { id: string } }).memory.id;
    expect(id).toBeTruthy();

    const list = await api("/api/memories?limit=10");
    expect(list.body).toMatchObject({ total: 1 });

    const search = await api("/api/search?q=temporal&mode=keyword");
    expect((search.body as { total: number }).total).toBe(1);
    expect((search.body as { data: { matched: string[] }[] }).data[0]!.matched).toContain(
      "temporal",
    );

    const insp = await api(`/api/memories/${id}`);
    expect(insp.status).toBe(200);
    expect(insp.body).toMatchObject({ memory: { id }, sources: [], history: expect.any(Array) });
    expect((insp.body as { related: unknown[] }).related).toBeDefined();
  });

  it("validates input and 404s cleanly", async () => {
    expect((await api("/api/memories", { method: "POST", body: JSON.stringify({}) })).status).toBe(
      400,
    );
    expect((await api("/api/search")).status).toBe(400);
    expect((await api("/api/memories/does-not-exist")).status).toBe(404);
  });

  it("updates, promotes, demotes, archives and deletes", async () => {
    expect(
      (
        await api(`/api/memories/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ importance: 0.95 }),
        })
      ).status,
    ).toBe(200);
    expect(
      ((await api(`/api/memories/${id}/promote`, { method: "POST" })).body as { level: string })
        .level,
    ).toBe("core");
    expect(
      ((await api(`/api/memories/${id}/demote`, { method: "POST" })).body as { level: string })
        .level,
    ).toBe("atomic");
    expect((await api(`/api/memories/${id}?archive=1`, { method: "DELETE" })).status).toBe(200);
    expect(((await api("/api/memories?status=archived")).body as { total: number }).total).toBe(1);
    expect((await api(`/api/memories/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(((await api("/api/memories")).body as { total: number }).total).toBe(0);
  });

  it("serves scenes, projects, sessions, sources, privacy and config", async () => {
    await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({
        content: "Policy metadata uses PostgreSQL JSONB.",
        type: "decision",
        scene: "Policy Store",
        agent: "test",
      }),
    });
    const scenes = (await api("/api/scenes?all=1")).body as {
      data: { id: string; name: string }[];
    };
    expect(scenes.data.length).toBeGreaterThan(0);
    const scene = (await api(`/api/scenes/${scenes.data[0]!.id}`)).body as { members: unknown[] };
    expect(scene.members.length).toBeGreaterThan(0);

    const projects = (await api("/api/projects")).body as { data: unknown[] };
    expect(Array.isArray(projects.data)).toBe(true);
    expect((await api("/api/sessions")).status).toBe(200);
    expect((await api("/api/sources")).status).toBe(200);
    expect((await api("/api/activity?limit=5")).status).toBe(200);
    expect((await api("/api/conflicts")).status).toBe(200);
    expect((await api("/api/privacy")).body).toMatchObject({
      storage: "local",
      telemetry: "disabled",
    });
    expect((await api("/api/config")).body).toMatchObject({ storage: { type: "sqlite" } });
    expect((await api("/api/consolidate", { method: "POST" })).status).toBe(200);
    expect((await api("/api/export")).status).toBe(200);
  });

  it("paginates without dumping the whole database", async () => {
    for (let i = 0; i < 5; i++) {
      await api("/api/memories", {
        method: "POST",
        body: JSON.stringify({
          content: `Paginated memory number ${i} about caching layers.`,
          force: true,
        }),
      });
    }
    const p1 = (await api("/api/memories?limit=2&offset=0")).body as {
      data: unknown[];
      total: number;
      limit: number;
      offset: number;
    };
    const p2 = (await api("/api/memories?limit=2&offset=2")).body as { data: unknown[] };
    expect(p1.data).toHaveLength(2);
    expect(p1).toMatchObject({ limit: 2, offset: 0 });
    expect(p2.data).toHaveLength(2);
    expect(p1.total).toBeGreaterThanOrEqual(5);
  });
});
