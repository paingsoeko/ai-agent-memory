import { loadConfig, type AIMemoryConfig, type DeepPartial } from "./config.js";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "./embeddings/provider.js";
import { resolveEmbeddingProvider } from "./embeddings/resolve.js";
import { MemoryEngine } from "./engine.js";
import { MemoryError } from "./errors.js";
import { SQLiteStore } from "./storage/sqlite/store.js";
import type { MemoryStore } from "./storage/store.js";
import type { MemoryExtractor } from "./types.js";

export interface CreateMemoryOptions extends DeepPartial<
  Omit<AIMemoryConfig, "embeddings" | "sources">
> {
  /** Active project name. */
  project?: string;
  /** Provide a custom store instead of the default SQLite store. */
  store?: MemoryStore;
  /** Provider config (by name) or an EmbeddingProvider instance. */
  embeddings?: Partial<EmbeddingProviderConfig> | EmbeddingProvider;
  /** Custom extractor for ingest(). */
  extractor?: MemoryExtractor;
  /** Working directory used to discover `.ai-memory.json` and git project name. */
  cwd?: string;
  /** Explicit config file path. */
  configPath?: string;
  /** Environment (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Do not read config files or detect the project from git (tests). */
  skipConfigFiles?: boolean;
  /** Storage path shortcut (same as storage.path). Use ":memory:" for an in-memory DB. */
  path?: string;
}

function isProvider(v: unknown): v is EmbeddingProvider {
  return (
    typeof v === "object" && v !== null && typeof (v as EmbeddingProvider).embed === "function"
  );
}

/**
 * Create a memory engine. With no options this opens (or creates)
 * `~/.ai-memory/memory.db`, applies user/project config and env overrides,
 * and enables keyword search only (no network).
 */
export async function createMemory(options: CreateMemoryOptions = {}): Promise<MemoryEngine> {
  const {
    store: customStore,
    embeddings,
    extractor,
    cwd,
    configPath,
    env,
    skipConfigFiles,
    path,
    project,
    ...rest
  } = options;
  const overrides: DeepPartial<AIMemoryConfig> = { ...(rest as DeepPartial<AIMemoryConfig>) };
  if (path) overrides.storage = { ...(overrides.storage ?? {}), path };
  if (project) overrides.project = project;
  if (embeddings && !isProvider(embeddings))
    overrides.embeddings = embeddings as DeepPartial<AIMemoryConfig["embeddings"]>;
  const config = loadConfig({ cwd, configPath, env, overrides, skipFiles: skipConfigFiles });

  const store = customStore ?? new SQLiteStore({ path: config.storage.path });
  await store.init();

  let provider: EmbeddingProvider | null = null;
  if (isProvider(embeddings)) provider = embeddings;
  else
    provider = await resolveEmbeddingProvider({
      ...config.embeddings,
      batchSize: config.embeddings.batchSize,
    });

  if (provider?.requiresNetwork && !config.privacy.allowNetworkEmbeddings) {
    await store.close();
    throw new MemoryError(
      "EMBEDDINGS",
      `Embedding provider "${provider.name}" sends text over the network, but privacy.allowNetworkEmbeddings is false.`,
      'Set privacy.allowNetworkEmbeddings=true in config (or AI_MEMORY_ALLOW_NETWORK_EMBEDDINGS=1) to opt in, or use the local "hash" provider.',
    );
  }
  if (provider && !config.search.semantic) config.search.semantic = true;

  return new MemoryEngine({ store, config, embeddingProvider: provider, extractor });
}
