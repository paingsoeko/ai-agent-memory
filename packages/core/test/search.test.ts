import { describe, expect, it } from "vitest";
import { HashingEmbeddingProvider, buildFtsQuery, reciprocalRankFusion } from "../src/index.js";
import { mem } from "./helpers.js";

describe("search", () => {
  it("builds safe FTS queries", () => {
    expect(buildFtsQuery("How does payroll generation work?")).toBe(
      '("payroll" OR "payroll"*) OR ("generation" OR "generation"*) OR ("work" OR "work"*)',
    );
    expect(buildFtsQuery("the a of")).toBeNull();
    expect(buildFtsQuery('"quoted" AND (weird) NOT')).toContain('"quoted"');
  });

  it("finds exact keywords", async () => {
    const m = await mem();
    await m.remember({ content: "Payroll generation uses Temporal workflows.", scope: "user" });
    await m.remember({ content: "Authentication uses JWT tokens.", scope: "user" });
    const r = await m.search({ query: "temporal" });
    expect(r).toHaveLength(1);
    expect(r[0]!.memory.content).toContain("Temporal");
    expect(r[0]!.source).toBe("keyword");
    await m.close();
  });

  it("matches fuzzy keywords via stemming and prefixes", async () => {
    const m = await mem();
    await m.remember({ content: "Node.js workers execute Temporal workflows.", scope: "user" });
    await m.remember({ content: "PostgreSQL is used as the primary database.", scope: "user" });
    expect((await m.search({ query: "executing workflow" }))[0]!.memory.content).toContain(
      "workers",
    );
    expect((await m.search({ query: "postgres" }))[0]!.memory.content).toContain("PostgreSQL");
    expect((await m.search({ query: "databases" }))[0]!.memory.content).toContain("database");
    await m.close();
  });

  it("supports semantic-only search with the local hash provider", async () => {
    const m = await mem({ embeddings: { provider: "hash" } });
    await m.remember({ content: "Payroll generation runs through Temporal.", scope: "user" });
    await m.remember({ content: "Frontend is built with React and Vite.", scope: "user" });
    const r = await m.search({ query: "payroll temporal", mode: "semantic" });
    expect(r[0]!.memory.content).toContain("Payroll");
    expect(r[0]!.source).toBe("semantic");
    await m.close();
  });

  it("hybrid search fuses keyword and semantic rankings with RRF", async () => {
    const m = await mem({ embeddings: { provider: "hash" } });
    await m.remember({ content: "Payroll generation runs through Temporal.", scope: "user" });
    await m.remember({ content: "Temporal headers carry the W3C traceparent.", scope: "user" });
    await m.remember({ content: "Frontend is built with React.", scope: "user" });
    const r = await m.search({ query: "payroll generation temporal", mode: "hybrid" });
    expect(r[0]!.memory.content).toContain("Payroll");
    expect(r[0]!.source).toBe("hybrid");
    expect(r[0]!.explanation).toMatch(/keyword #1.*semantic #1/);
    await m.close();
  });

  it("reciprocal rank fusion prefers items ranked well by both lists", () => {
    const fused = reciprocalRankFusion(
      [
        {
          name: "keyword",
          results: [
            { id: "a", score: 3 },
            { id: "b", score: 2 },
            { id: "c", score: 1 },
          ],
        },
        {
          name: "semantic",
          results: [
            { id: "b", score: 0.9 },
            { id: "c", score: 0.8 },
            { id: "d", score: 0.7 },
          ],
        },
      ],
      60,
    );
    expect(fused[0]!.id).toBe("b");
    expect(fused[0]!.rrf).toBeCloseTo(1 / 62 + 1 / 61);
    expect(fused.map((f) => f.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("recall boosts importance, project match and records access", async () => {
    const m = await mem({ project: "my-app" });
    await m.remember({ content: "Payroll uses Temporal.", importance: 0.2, scope: "user" });
    const important = await m.remember({
      content: "Payroll uses Temporal workflows for scheduling.",
      importance: 0.95,
      force: true,
    });
    const r = await m.recall({ query: "payroll temporal" });
    expect(r[0]!.memory.id).toBe(important.memory.id);
    expect(r[0]!.explanation).toContain("project match");
    expect(r[0]!.memory.accessCount).toBe(1);
    expect((await m.get(important.memory.id)).accessCount).toBe(1);
    const again = await m.search({ query: "payroll" });
    expect((await m.get(again[0]!.memory.id)).accessCount).toBe(1); // search does not track
    await m.close();
  });

  it("hash embeddings are deterministic and normalised", async () => {
    const p = new HashingEmbeddingProvider(64);
    const a = await p.embed("Payroll uses Temporal");
    const b = await p.embed("Payroll uses Temporal");
    expect(a).toEqual(b);
    expect(a.reduce((s, x) => s + x * x, 0)).toBeCloseTo(1, 5);
    const [c] = await p.embedBatch(["Something completely different about frontend"]);
    const dot = a.reduce((s, x, i) => s + x * c![i]!, 0);
    expect(dot).toBeLessThan(0.5);
  });
});
