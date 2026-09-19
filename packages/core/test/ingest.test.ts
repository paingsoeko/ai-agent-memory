import { describe, expect, it } from "vitest";
import {
  createHeuristicExtractor,
  looksLikeSecret,
  type ExtractedCandidate,
} from "../src/index.js";
import { mem } from "./helpers.js";

describe("ingestion", () => {
  it("stores raw events and extracts only durable knowledge", async () => {
    const m = await mem({ project: "my-app" });
    const result = await m.ingest({
      sessionId: "s1",
      agent: "claude",
      messages: [
        {
          role: "user",
          content:
            "Can you look at the payroll module? We decided to use Temporal for payroll generation. Let me know what you find.",
        },
        {
          role: "assistant",
          content:
            "Sure! Let me check the files now... Payroll workflows are started by Laravel and executed by Node.js workers. Here's what I found.",
        },
        { role: "user", content: "Remember: all distributed tracing uses W3C traceparent." },
        { role: "user", content: "ok thanks" },
        { role: "tool", content: "npm test passed 42 tests" },
        { role: "user", content: "My token is sk-1234567890abcdefghijklmnop please use it" },
      ],
    });
    expect(result.events).toHaveLength(6);
    expect(result.events[0]!.projectId).toBe("my-app");
    const contents = result.results.map((r) => r.memory.content);
    expect(contents).toContain("We decided to use Temporal for payroll generation.");
    expect(contents).toContain("All distributed tracing uses W3C traceparent.");
    expect(contents.some((c) => /sk-1234/.test(c))).toBe(false);
    expect(contents.some((c) => /Let me|ok thanks|npm test/i.test(c))).toBe(false);
    // provenance links back to the raw message
    const decision = result.results.find((r) => r.memory.content.startsWith("We decided"))!;
    const insp = await m.inspect(decision.memory.id);
    expect(insp.sources[0]!.content).toContain("Can you look at the payroll module");
    expect(insp.memory.type).toBe("decision");
    expect(insp.memory.sessionId).toBe("s1");
    expect(insp.memory.agent).toBe("claude");
    await m.close();
  });

  it("classifies types and lowers assistant confidence", () => {
    const extract = createHeuristicExtractor();
    const c = extract(
      [
        { role: "user", content: "I prefer PostgreSQL for backend projects." },
        { role: "assistant", content: "The service runs on Kubernetes in eu-west-1." },
        { role: "user", content: "Convention: all shared models live in packages/common." },
        { role: "user", content: "What time is it?" },
      ],
      {},
    ) as ExtractedCandidate[];
    expect(c.find((x) => x.content.includes("PostgreSQL"))?.type).toBe("preference");
    const arch = c.find((x) => x.content.includes("Kubernetes"))!;
    expect(arch.type).toBe("architecture");
    expect(arch.confidence).toBeLessThan(0.75);
    expect(c.find((x) => x.content.includes("packages/common"))?.type).toBe("convention");
    expect(c.some((x) => x.content.includes("What time"))).toBe(false);
  });

  it("supports a custom extractor and rawOnly mode", async () => {
    const m = await mem({ project: "p" });
    const raw = await m.ingest({
      messages: [{ role: "user", content: "we decided to use bun" }],
      rawOnly: true,
    });
    expect(raw.results).toHaveLength(0);
    expect(raw.events).toHaveLength(1);
    const custom = await m.ingest({
      messages: [{ role: "user", content: "anything" }],
      extractor: () => [
        {
          content: "LLM extracted: use bun for scripts.",
          type: "convention",
          confidence: 0.9,
          importance: 0.7,
          messageIndex: 0,
          reason: "llm",
        },
      ],
    });
    expect(custom.results[0]!.memory.metadata.extractedBy).toBe("custom");
    await m.close();
  });

  it("respects minConfidence and maxPerBatch", async () => {
    const m = await mem({
      project: "p",
      memory: { ingest: { maxPerBatch: 1, minConfidence: 0.6 } },
    });
    const r = await m.ingest({
      messages: [
        {
          role: "user",
          content:
            "We decided to use Temporal. We decided to use PostgreSQL. We decided to use Redis.",
        },
      ],
    });
    expect(r.results).toHaveLength(1);
    expect(r.skipped).toBe(2);
    await m.close();
  });

  it("detects secrets", () => {
    expect(looksLikeSecret("AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(looksLikeSecret("password: hunter2secret")).toBe(true);
    expect(looksLikeSecret("Payroll uses Temporal")).toBe(false);
  });

  it("marks secret-looking remembered content as sensitive and never embeds it via network providers", async () => {
    const m = await mem({
      project: "p",
      privacy: { allowNetworkEmbeddings: true },
      embeddings: {
        name: "fake",
        model: "fake",
        requiresNetwork: true,
        embed: async () => [1, 0],
        embedBatch: async (t) => t.map(() => [1, 0]),
      },
    });
    const r = await m.remember({
      content: "The deploy token is ghp_abcdefghijklmnopqrstuvwxyz1234",
    });
    expect(r.memory.sensitive).toBe(true);
    expect(await m.store.getEmbedding(r.memory.id, "fake")).toBeNull();
    const ok = await m.remember({ content: "Deploys run on GitHub Actions." });
    expect(await m.store.getEmbedding(ok.memory.id, "fake")).not.toBeNull();
    await m.close();
  });
});
