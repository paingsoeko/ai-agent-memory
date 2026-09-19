import { keyTerms } from "../util/text.js";
import type { EmbeddingProvider } from "./provider.js";

function fnv1a(str: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Fully local, deterministic "hashing trick" embedding. It is a lexical
 * feature vector (stemmed terms, term bigrams, character trigrams) projected
 * into a fixed-size space, then L2-normalised. It gives useful fuzzy matching
 * with zero dependencies and zero network, but it is NOT a neural semantic
 * model: use `@ai-agent-memory/embeddings` (transformers.js / Ollama / API) for that.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly name = "hash";
  readonly model: string;
  readonly dimensions: number;
  readonly requiresNetwork = false;

  constructor(dimensions = 256) {
    this.dimensions = dimensions;
    this.model = `hash-v1-${dimensions}`;
  }

  private add(vec: Float64Array, feature: string, weight: number) {
    const h = fnv1a(feature);
    const idx = h % this.dimensions;
    const sign = (fnv1a(feature, 0x9747b28c) & 1) === 0 ? 1 : -1;
    vec[idx] = (vec[idx] ?? 0) + sign * weight;
  }

  embedSync(text: string): number[] {
    const vec = new Float64Array(this.dimensions);
    const terms = keyTerms(text);
    for (let i = 0; i < terms.length; i++) {
      const t = terms[i]!;
      this.add(vec, `t:${t}`, 1.0);
      if (i > 0) this.add(vec, `b:${terms[i - 1]}_${t}`, 0.6);
      const padded = `_${t}_`;
      for (let j = 0; j + 3 <= padded.length; j++)
        this.add(vec, `c:${padded.slice(j, j + 3)}`, 0.35);
    }
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i]! * vec[i]!;
    norm = Math.sqrt(norm) || 1;
    return Array.from(vec, (v) => v / norm);
  }

  async embed(text: string): Promise<number[]> {
    return this.embedSync(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedSync(t));
  }
}
