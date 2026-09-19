/**
 * Vendor-neutral embedding abstraction. Core never talks to a specific API;
 * providers are registered by name and resolved from config.
 */
export interface EmbeddingProvider {
  /** Short provider name, e.g. "hash", "ollama", "openai". */
  readonly name: string;
  /** Model identifier; embeddings are stored per model so switching is safe. */
  readonly model: string;
  readonly dimensions?: number;
  /** True when embedding sends text over the network (even to localhost). */
  readonly requiresNetwork: boolean;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingProviderConfig {
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  dimensions?: number;
  batchSize?: number;
  options?: Record<string, unknown>;
}

export type EmbeddingProviderFactory = (
  config: EmbeddingProviderConfig,
) => EmbeddingProvider | Promise<EmbeddingProvider>;

const registry = new Map<string, EmbeddingProviderFactory>();

export function registerEmbeddingProvider(name: string, factory: EmbeddingProviderFactory): void {
  registry.set(name, factory);
}

export function getRegisteredEmbeddingProviders(): string[] {
  return [...registry.keys()].sort();
}

export function getEmbeddingProviderFactory(name: string): EmbeddingProviderFactory | undefined {
  return registry.get(name);
}

/** Wrap a plain embed function as a provider. */
export function customEmbeddingProvider(opts: {
  name?: string;
  model: string;
  dimensions?: number;
  requiresNetwork?: boolean;
  embed: (text: string) => Promise<number[]>;
  embedBatch?: (texts: string[]) => Promise<number[][]>;
}): EmbeddingProvider {
  return {
    name: opts.name ?? "custom",
    model: opts.model,
    dimensions: opts.dimensions,
    requiresNetwork: opts.requiresNetwork ?? true,
    embed: opts.embed,
    embedBatch: opts.embedBatch ?? (async (texts) => Promise.all(texts.map((t) => opts.embed(t)))),
  };
}
