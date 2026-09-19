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

async function remember(content: string, extra: Record<string, unknown> = {}) {
  const r = await api("/api/memories", {
    method: "POST",
    body: JSON.stringify({ content, agent: "test", ...extra }),
  });
  expect(r.status).toBe(201);
  return (r.body as { memory: { id: string } }).memory.id;
}

beforeAll(async () => {
  srv = await startServer({
    port: 4141,
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

describe("memory graph", () => {
  it("builds L1/L2 nodes with belongs_to edges from real scene membership", async () => {
    await remember("Payroll generation uses Temporal workflows.", {
      type: "architecture",
      scene: "Payroll",
    });
    await remember("Traceparent propagates through Temporal headers.", {
      type: "fact",
      scene: "Payroll",
      force: true,
    });
    const g = (await api("/api/memory-graph")).body as {
      nodes: { id: string; level: string }[];
      edges: { type: string; source: string; target: string }[];
      stats: Record<string, number>;
      totals: Record<string, number>;
    };
    expect(g.nodes.some((n) => n.level === "L1")).toBe(true);
    expect(g.nodes.some((n) => n.level === "L2")).toBe(true);
    expect(g.edges.some((e) => e.type === "belongs_to")).toBe(true);
    expect(g.totals.L1).toBeGreaterThanOrEqual(2);
    // Every edge references nodes present in the payload.
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it("scales node strength with level and exposes core backbone", async () => {
    const id = await remember("Graph core fact for promotion.", { importance: 0.95, force: true });
    await api(`/api/memories/${id}/promote`, { method: "POST" });
    const g = (await api("/api/memory-graph")).body as {
      nodes: { id: string; level: string; refId: string }[];
      stats: { L3: number };
    };
    expect(g.stats.L3).toBe(1);
    expect(g.nodes.find((n) => n.refId === id)?.level).toBe("L3");
    const l3 = (await api("/api/memory-graph?level=L3")).body as { nodes: unknown[] };
    expect(l3.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it("matches query nodes and resolves focus neighborhoods", async () => {
    const q = (await api("/api/memory-graph?query=temporal")).body as {
      nodes: { matched?: boolean }[];
    };
    expect(q.nodes.filter((n) => n.matched).length).toBeGreaterThan(0);
    const mems = (await api("/api/memories?q=temporal&limit=1")).body as {
      data: { id: string }[];
    };
    const f = (await api(`/api/memory-graph?focus=${mems.data[0]!.id}`)).body as {
      nodes: unknown[];
    };
    expect(f.nodes.length).toBeGreaterThan(0);
  });
});
