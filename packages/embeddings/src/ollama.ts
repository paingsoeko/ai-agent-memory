import { MemoryError, type EmbeddingProvider } from "@ai-memory/core";

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  batchSize?: number;
  fetch?: typeof fetch;
}

/**
 * Embeddings via a local Ollama server (`ollama pull nomic-embed-text`).
 * Runs on your machine, but it is still an HTTP call, so it is flagged as
 * requiring network and must be explicitly allowed.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = "ollama";
  readonly model: string;
  readonly requiresNetwork = true;
  private readonly baseUrl: string;
  private readonly batchSize: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
    this.model = options.model ?? "nomic-embed-text";
    this.batchSize = options.batchSize ?? 32;
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  async embed(text: string): Promise<number[]> {
    const [v] = await this.embedBatch([text]);
    return v!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const chunk = texts.slice(i, i + this.batchSize);
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}/api/embed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: this.model, input: chunk }),
        });
      } catch (err) {
        throw new MemoryError(
          "EMBEDDINGS",
          `Could not reach Ollama at ${this.baseUrl}: ${(err as Error).message}`,
          "Start Ollama (`ollama serve`) or change embeddings.baseUrl.",
        );
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new MemoryError(
          "EMBEDDINGS",
          `Ollama embedding failed: ${res.status} ${body.slice(0, 200)}`,
          `Run \`ollama pull ${this.model}\`.`,
        );
      }
      const json = (await res.json()) as { embeddings?: number[][] };
      if (!json.embeddings || json.embeddings.length !== chunk.length) {
        throw new MemoryError("EMBEDDINGS", "Ollama response had an unexpected shape.");
      }
      out.push(...json.embeddings);
    }
    return out;
  }
}
