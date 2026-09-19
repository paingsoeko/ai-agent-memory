import { MemoryError } from "../errors.js";
import { HashingEmbeddingProvider } from "./hashing.js";
import {
  getEmbeddingProviderFactory,
  getRegisteredEmbeddingProviders,
  registerEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingProviderConfig,
} from "./provider.js";

registerEmbeddingProvider("hash", (cfg) => new HashingEmbeddingProvider(cfg.dimensions ?? 256));
registerEmbeddingProvider(
  "local-hash",
  (cfg) => new HashingEmbeddingProvider(cfg.dimensions ?? 256),
);

/**
 * Resolve a provider by name. Built-ins: "none" (null) and "hash".
 * Other names are looked up in the registry; if missing, we try to load
 * `@local-ai-agent-memory/embeddings` (which registers "local", "ollama", "openai", ...).
 */
export async function resolveEmbeddingProvider(
  config: EmbeddingProviderConfig,
): Promise<EmbeddingProvider | null> {
  const name = (config.provider ?? "none").toLowerCase();
  if (name === "none" || name === "" || name === "off" || name === "false") return null;
  let factory = getEmbeddingProviderFactory(name);
  if (!factory) {
    try {
      // Optional companion package; registers additional providers on import.
      await import("@local-ai-agent-memory/embeddings" as string);
    } catch {
      /* not installed */
    }
    factory = getEmbeddingProviderFactory(name);
  }
  if (!factory) {
    throw new MemoryError(
      "EMBEDDINGS",
      `Unknown embedding provider "${config.provider}". Registered: ${getRegisteredEmbeddingProviders().join(", ") || "none"}.`,
      'Install @local-ai-agent-memory/embeddings for "local", "ollama" and "openai", or set embeddings.provider to "hash" / "none".',
    );
  }
  return factory(config);
}
