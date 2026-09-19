import { MemoryError, type EmbeddingProvider } from "@local-ai-agent-memory/core";

export interface OpenAICompatibleOptions {
  /** Base URL of an OpenAI-compatible API, e.g. https://api.openai.com/v1 */
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  dimensions?: number;
  batchSize?: number;
  /** Extra headers (e.g. OpenRouter attribution headers). */
  headers?: Record<string, string>;
  name?: string;
  fetch?: typeof fetch;
}

/**
 * Embeddings over any OpenAI-compatible `/embeddings` endpoint: OpenAI,
 * OpenRouter, Azure-compatible gateways, LM Studio, vLLM, LiteLLM, ...
 * Sends memory text over the network: only enabled when the user opts in.
 */
export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions?: number;
  readonly requiresNetwork = true;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly batchSize: number;
  private readonly headers: Record<string, string>;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAICompatibleOptions = {}) {
    this.name = options.name ?? "openai";
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model ?? "text-embedding-3-small";
    this.dimensions = options.dimensions;
    this.batchSize = options.batchSize ?? 64;
    this.headers = options.headers ?? {};
    this.fetchFn = options.fetch ?? globalThis.fetch;
    if (!this.fetchFn) throw new MemoryError("EMBEDDINGS", "global fetch is not available");
  }

  async embed(text: string): Promise<number[]> {
    const [v] = await this.embedBatch([text]);
    return v!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const chunk = texts.slice(i, i + this.batchSize);
      const res = await this.fetchFn(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          ...this.headers,
        },
        body: JSON.stringify({
          model: this.model,
          input: chunk,
          ...(this.dimensions ? { dimensions: this.dimensions } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new MemoryError(
          "EMBEDDINGS",
          `Embedding request to ${this.baseUrl} failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`,
          "Check the API key, base URL and model name.",
        );
      }
      const json = (await res.json()) as { data?: { index?: number; embedding: number[] }[] };
      if (!json.data || json.data.length !== chunk.length) {
        throw new MemoryError("EMBEDDINGS", "Embedding response had an unexpected shape.");
      }
      const sorted = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      out.push(...sorted.map((d) => d.embedding));
    }
    return out;
  }
}
