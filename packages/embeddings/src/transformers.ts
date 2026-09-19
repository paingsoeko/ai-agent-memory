import { MemoryError, type EmbeddingProvider } from "@local-ai-agent-memory/core";

export interface TransformersOptions {
  /** Hugging Face model id (default Xenova/all-MiniLM-L6-v2). */
  model?: string;
  batchSize?: number;
  /** Local cache dir for model files. */
  cacheDir?: string;
  /** Only use already-downloaded models; never touch the network. */
  localFilesOnly?: boolean;
}

type FeaturePipeline = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * Fully local neural embeddings through transformers.js (ONNX runtime).
 * Memory text never leaves the process. The model files are downloaded from
 * the Hugging Face Hub the first time (one-time network access, no data sent),
 * then cached; set `localFilesOnly` to forbid even that.
 * Requires the optional dependency `@huggingface/transformers`.
 */
export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local";
  readonly model: string;
  readonly requiresNetwork = false;
  private readonly batchSize: number;
  private readonly options: TransformersOptions;
  private pipe: Promise<FeaturePipeline> | null = null;

  constructor(options: TransformersOptions = {}) {
    this.options = options;
    this.model = options.model ?? "Xenova/all-MiniLM-L6-v2";
    this.batchSize = options.batchSize ?? 16;
  }

  private load(): Promise<FeaturePipeline> {
    if (!this.pipe) {
      this.pipe = (async () => {
        let mod: {
          pipeline: (
            task: string,
            model: string,
            opts?: Record<string, unknown>,
          ) => Promise<unknown>;
          env?: Record<string, unknown>;
        };
        try {
          mod = (await import("@huggingface/transformers" as string)) as typeof mod;
        } catch {
          throw new MemoryError(
            "EMBEDDINGS",
            'The "local" embedding provider needs the optional package @huggingface/transformers.',
            'Run `npm install @huggingface/transformers`, or use embeddings.provider = "hash" (built-in, no dependencies).',
          );
        }
        if (mod.env && this.options.cacheDir) mod.env.cacheDir = this.options.cacheDir;
        if (mod.env && this.options.localFilesOnly) mod.env.allowRemoteModels = false;
        return (await mod.pipeline("feature-extraction", this.model, {
          dtype: "fp32",
        })) as FeaturePipeline;
      })();
    }
    return this.pipe;
  }

  async embed(text: string): Promise<number[]> {
    const [v] = await this.embedBatch([text]);
    return v!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const pipe = await this.load();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const res = await pipe(texts.slice(i, i + this.batchSize), {
        pooling: "mean",
        normalize: true,
      });
      out.push(...res.tolist());
    }
    return out;
  }
}
