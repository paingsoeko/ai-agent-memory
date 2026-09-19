import { registerEmbeddingProvider } from "@ai-memory/core";
import { OllamaEmbeddingProvider } from "./ollama.js";
import { OpenAICompatibleEmbeddingProvider } from "./openai.js";
import { TransformersEmbeddingProvider } from "./transformers.js";

export { OpenAICompatibleEmbeddingProvider, type OpenAICompatibleOptions } from "./openai.js";
export { OllamaEmbeddingProvider, type OllamaOptions } from "./ollama.js";
export { TransformersEmbeddingProvider, type TransformersOptions } from "./transformers.js";

/** Alias kept for readability in configs/docs. */
export const OpenAIEmbeddingProvider = OpenAICompatibleEmbeddingProvider;
export const LocalEmbeddingProvider = TransformersEmbeddingProvider;

const env = () => (typeof process !== "undefined" ? process.env : {});

/** Register all providers by name. Importing this module does this automatically. */
export function registerEmbeddingProviders(): void {
  registerEmbeddingProvider(
    "openai",
    (c) =>
      new OpenAICompatibleEmbeddingProvider({
        name: "openai",
        baseUrl: c.baseUrl ?? env().OPENAI_BASE_URL,
        apiKey: c.apiKey ?? env().OPENAI_API_KEY,
        model: c.model,
        dimensions: c.dimensions,
        batchSize: c.batchSize,
      }),
  );
  registerEmbeddingProvider(
    "openai-compatible",
    (c) =>
      new OpenAICompatibleEmbeddingProvider({
        name: "openai-compatible",
        baseUrl: c.baseUrl,
        apiKey: c.apiKey,
        model: c.model,
        dimensions: c.dimensions,
        batchSize: c.batchSize,
      }),
  );
  registerEmbeddingProvider(
    "openrouter",
    (c) =>
      new OpenAICompatibleEmbeddingProvider({
        name: "openrouter",
        baseUrl: c.baseUrl ?? "https://openrouter.ai/api/v1",
        apiKey: c.apiKey ?? env().OPENROUTER_API_KEY,
        model: c.model ?? "openai/text-embedding-3-small",
        dimensions: c.dimensions,
        batchSize: c.batchSize,
        headers: {
          "HTTP-Referer": "https://github.com/paingsoeko/ai-agent-memory",
          "X-Title": "ai-memory",
        },
      }),
  );
  registerEmbeddingProvider(
    "ollama",
    (c) =>
      new OllamaEmbeddingProvider({
        baseUrl: c.baseUrl ?? env().OLLAMA_HOST,
        model: c.model,
        batchSize: c.batchSize,
      }),
  );
  const local = (c: { model?: string; batchSize?: number; options?: Record<string, unknown> }) =>
    new TransformersEmbeddingProvider({
      model: c.model,
      batchSize: c.batchSize,
      cacheDir: c.options?.cacheDir as string | undefined,
      localFilesOnly: c.options?.localFilesOnly as boolean | undefined,
    });
  registerEmbeddingProvider("local", local);
  registerEmbeddingProvider("transformers", local);
}

registerEmbeddingProviders();
