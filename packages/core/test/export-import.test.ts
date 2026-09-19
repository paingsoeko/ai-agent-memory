import { describe, expect, it } from "vitest";
import { mem } from "./helpers.js";

describe("export / import", () => {
  it("round-trips projects, events, memories, scenes and embeddings", async () => {
    const a = await mem({ project: "p", embeddings: { provider: "hash" } });
    const e = await a.addEvent({ kind: "message", role: "user", content: "we use temporal" });
    const r = await a.remember({
      content: "Payroll uses Temporal.",
      sourceIds: [e.id],
      scene: "Payroll Architecture",
      tags: ["infra"],
    });
    const data = await a.export({ includeEmbeddings: true });
    expect(data.memories).toHaveLength(1);
    expect(data.events).toHaveLength(1);
    expect(data.scenes[0]!.memoryIds).toEqual([r.memory.id]);
    expect(data.embeddings).toHaveLength(1);

    const b = await mem({ project: "p", embeddings: { provider: "hash" } });
    const json = JSON.parse(JSON.stringify(data));
    const res = await b.import(json);
    expect(res).toMatchObject({
      projects: 1,
      events: 1,
      memories: 1,
      scenes: 1,
      embeddings: 1,
      skipped: 0,
    });
    const insp = await b.inspect(r.memory.id);
    expect(insp.memory.tags).toEqual(["infra"]);
    expect(insp.sources[0]!.id).toBe(e.id);
    expect(insp.scenes[0]!.name).toBe("Payroll Architecture");
    expect(await b.store.getEmbedding(r.memory.id, "hash-v1-256")).not.toBeNull();
    // importing again skips duplicates
    const again = await b.import(json);
    expect(again.skipped).toBe(2);
    expect(again.memories).toBe(0);
    await expect(b.import({} as never)).rejects.toThrow(/Invalid export/);
    await a.close();
    await b.close();
  });
});
