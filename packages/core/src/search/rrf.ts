import type { ScoredId } from "../storage/store.js";

export interface FusedCandidate {
  id: string;
  rrf: number;
  /** Which rankers contributed. */
  sources: Set<"keyword" | "semantic">;
  keywordRank?: number;
  semanticRank?: number;
  keywordScore?: number;
  semanticScore?: number;
}

/**
 * Reciprocal Rank Fusion: score(d) = Σ_i 1 / (k + rank_i(d)).
 * Input lists must already be sorted best-first.
 */
export function reciprocalRankFusion(
  lists: { name: "keyword" | "semantic"; results: ScoredId[] }[],
  k = 60,
): FusedCandidate[] {
  const map = new Map<string, FusedCandidate>();
  for (const { name, results } of lists) {
    results.forEach((r, i) => {
      const rank = i + 1;
      let c = map.get(r.id);
      if (!c) {
        c = { id: r.id, rrf: 0, sources: new Set() };
        map.set(r.id, c);
      }
      c.rrf += 1 / (k + rank);
      c.sources.add(name);
      if (name === "keyword") {
        c.keywordRank = rank;
        c.keywordScore = r.score;
      } else {
        c.semanticRank = rank;
        c.semanticScore = r.score;
      }
    });
  }
  return [...map.values()].sort((a, b) => b.rrf - a.rrf);
}
