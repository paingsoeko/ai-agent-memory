import type { MemoryStore } from "../storage/store.js";
import type { Memory, MemoryFilter } from "../types.js";
import { contentHash, cosine, diceSimilarity, normalizeContent } from "../util/text.js";
import { negationConflict, statementsConflict } from "./conflict.js";

export interface DedupDecision {
  kind: "none" | "duplicate" | "conflict";
  memory?: Memory;
  similarity?: number;
  reason?: string;
}

export interface DedupOptions {
  threshold: number;
  semanticThreshold: number;
  /** Optional query vector of the new content plus model to compare embeddings. */
  vector?: Float32Array;
  model?: string;
}

/**
 * Decide whether new content duplicates or conflicts with an existing memory
 * visible under `filter`.
 *
 *   exact hash match           -> duplicate
 *   lexical/semantic sim >= t  -> duplicate
 *   same subject+predicate,
 *   different object           -> conflict
 *   otherwise                  -> none
 */
export async function detectDuplicateOrConflict(
  store: MemoryStore,
  content: string,
  filter: MemoryFilter,
  options: DedupOptions,
): Promise<DedupDecision> {
  const hash = contentHash(content);
  const exact = await store.findByHash(hash, filter);
  if (exact.length > 0) {
    return { kind: "duplicate", memory: exact[0], similarity: 1, reason: "exact match" };
  }

  const candidatesIds = await store.searchKeyword(content, filter, 12);
  if (candidatesIds.length === 0) return { kind: "none" };
  const candidates = await store.getMemories(candidatesIds.map((c) => c.id));

  let best: { memory: Memory; sim: number; how: string } | null = null;
  let conflict: { memory: Memory; sim: number } | null = null;
  const norm = normalizeContent(content);
  for (const mem of candidates) {
    if (normalizeContent(mem.content) === norm) {
      return { kind: "duplicate", memory: mem, similarity: 1, reason: "normalised match" };
    }
    let sim = diceSimilarity(content, mem.content);
    let how = "lexical";
    if (options.vector && options.model) {
      const emb = await store.getEmbedding(mem.id, options.model);
      if (emb) {
        const cos = cosine(options.vector, emb);
        if (cos >= options.semanticThreshold && cos > sim) {
          sim = cos;
          how = "semantic";
        }
      }
    }
    const isConflict =
      statementsConflict(content, mem.content) || negationConflict(content, mem.content);
    if (isConflict) {
      if (!conflict || sim > conflict.sim) conflict = { memory: mem, sim };
      continue;
    }
    if (!best || sim > best.sim) best = { memory: mem, sim, how };
  }
  const threshold = options.threshold;
  if (
    best &&
    (best.sim >= threshold || (best.how === "semantic" && best.sim >= options.semanticThreshold))
  ) {
    return {
      kind: "duplicate",
      memory: best.memory,
      similarity: best.sim,
      reason: `${best.how} similarity ${best.sim.toFixed(2)}`,
    };
  }
  if (conflict) {
    return {
      kind: "conflict",
      memory: conflict.memory,
      similarity: conflict.sim,
      reason: "same subject, different value",
    };
  }
  return { kind: "none", similarity: best?.sim };
}
