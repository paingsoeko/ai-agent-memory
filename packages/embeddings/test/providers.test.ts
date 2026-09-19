import { createMemory, getRegisteredEmbeddingProviders } from "@ai-memory/core";
import { describe, expect, it } from "vitest";
import {
  OllamaEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
  TransformersEmbeddingProvider,
} from "../src/index.js";

const fakeFetch = (handler: (url: string, body: unknown) => unknown): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const result = handler(String(url), body);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

describe("@ai-memory/embeddings", () => {
  it("registers providers into core on import", () => {
    const names = getRegisteredEmbeddingProviders();
    for (const n of ["openai", "openai-compatible", "openrouter", "ollama", "local", "hash"])
      expect(names).toContain(n);
  });

  it("OpenAI-compatible provider batches requests and preserves order", async () => {
    const calls: unknown[] = [];
    const p = new OpenAICompatibleEmbeddingProvider({
      apiKey: "k",
      batchSize: 2,
      model: "m",
      fetch: fakeFetch((url, body) => {
        calls.push({ url, body });
        const input = (body as { input: string[] }).input;
        return { data: input.map((t, i) => ({ index: i, embedding: [t.length] })).reverse() };
      }),
    });
    const v = await p.embedBatch(["a", "bb", "ccc"]);
    expect(v).toEqual([[1], [2], [3]]);
    expect(calls).toHaveLength(2);
    expect((calls[0] as { url: string }).url).toBe("https://api.openai.com/v1/embeddings");
    expect(p.requiresNetwork).toBe(true);
  });

  it("OpenAI-compatible provider surfaces HTTP errors", async () => {
    const p = new OpenAICompatibleEmbeddingProvider({
      fetch: (async () =>
        new Response("nope", { status: 401, statusText: "Unauthorized" })) as typeof fetch,
    });
    await expect(p.embed("x")).rejects.toThrow(/401/);
  });

  it("Ollama provider calls /api/embed", async () => {
    const p = new OllamaEmbeddingProvider({
      model: "nomic-embed-text",
      fetch: fakeFetch((url, body) => {
        expect(url).toBe("http://127.0.0.1:11434/api/embed");
        return { embeddings: (body as { input: string[] }).input.map(() => [0.1, 0.2]) };
      }),
    });
    expect(await p.embed("hello")).toEqual([0.1, 0.2]);
  });

  it("transformers provider gives a helpful error when the optional dependency is missing", async () => {
    const p = new TransformersEmbeddingProvider();
    let installed = true;
    try {
      await import("@huggingface/transformers" as string);
    } catch {
      installed = false;
    }
    if (installed) return;
    await expect(p.embed("x")).rejects.toThrow(/@huggingface\/transformers/);
  });

  it("network providers are blocked by default and usable when allowed", async () => {
    await expect(
      createMemory({ path: ":memory:", skipConfigFiles: true, embeddings: { provider: "ollama" } }),
    ).rejects.toThrow(/allowNetworkEmbeddings/);
    const m = await createMemory({
      path: ":memory:",
      skipConfigFiles: true,
      privacy: { allowNetworkEmbeddings: true },
      embeddings: new OllamaEmbeddingProvider({
        fetch: fakeFetch((_u, b) => ({
          embeddings: (b as { input: string[] }).input.map((t) => [
            t.includes("payroll") ? 1 : 0,
            1,
          ]),
        })),
      }),
    });
    await m.remember({ content: "payroll runs nightly", scope: "user" });
    await m.remember({ content: "frontend uses react", scope: "user" });
    const r = await m.search({ query: "payroll", mode: "semantic" });
    expect(r[0]!.memory.content).toContain("payroll");
    expect(m.privacy().embeddingsNetwork).toBe("required");
    await m.close();
  });
});
