import type { RankingWeights } from "../config.js";
import type { Memory, MemoryResult } from "../types.js";
import type { FusedCandidate } from "./rrf.js";

export interface RankContext {
  projectId?: string;
  weights: RankingWeights;
  recencyHalfLifeDays: number;
  now?: Date;
  /** When false only the relevance signal is used (pure search). */
  applyBoosts: boolean;
}

export function recencyScore(date: Date, halfLifeDays: number, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / Math.max(1, halfLifeDays));
}

export function accessScore(count: number): number {
  return Math.min(1, Math.log1p(Math.max(0, count)) / Math.log1p(50));
}

/**
 * Final ranking: normalised RRF relevance plus (optionally) importance,
 * confidence, recency, access frequency, project match and level boosts.
 */
export function rankCandidates(
  candidates: FusedCandidate[],
  memories: Map<string, Memory>,
  ctx: RankContext,
): MemoryResult[] {
  const now = ctx.now ?? new Date();
  const maxRrf = candidates.reduce((m, c) => Math.max(m, c.rrf), 0) || 1;
  const w = ctx.weights;
  const out: MemoryResult[] = [];
  for (const c of candidates) {
    const mem = memories.get(c.id);
    if (!mem) continue;
    const rel = c.rrf / maxRrf;
    const parts: string[] = [];
    let score: number;
    if (!ctx.applyBoosts) {
      score = rel;
    } else {
      const rec = recencyScore(mem.updatedAt, ctx.recencyHalfLifeDays, now);
      const acc = accessScore(mem.accessCount);
      const proj = ctx.projectId && mem.projectId === ctx.projectId ? 1 : 0;
      const lvl = mem.level === "core" ? 1 : 0;
      score =
        w.relevance * rel +
        w.importance * mem.importance +
        w.confidence * mem.confidence +
        w.recency * rec +
        w.access * acc +
        w.project * proj +
        w.level * lvl;
      parts.push(
        `importance ${mem.importance.toFixed(2)}`,
        `confidence ${mem.confidence.toFixed(2)}`,
        `recency ${rec.toFixed(2)}`,
      );
      if (mem.accessCount) parts.push(`accessed ${mem.accessCount}x`);
      if (proj) parts.push("project match");
      if (lvl) parts.push("core memory");
    }
    const via: string[] = [];
    if (c.keywordRank) via.push(`keyword #${c.keywordRank}`);
    if (c.semanticRank) via.push(`semantic #${c.semanticRank}`);
    const source: MemoryResult["source"] =
      c.sources.size === 2 ? "hybrid" : c.sources.has("semantic") ? "semantic" : "keyword";
    out.push({
      memory: mem,
      score: Number(score.toFixed(6)),
      source,
      explanation: [via.join(", "), ...parts].filter(Boolean).join("; "),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}
