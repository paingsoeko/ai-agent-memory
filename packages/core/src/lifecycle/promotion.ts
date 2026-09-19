import type { PromotionCriteria } from "../config.js";
import type { Memory } from "../types.js";

export interface PromotionEvaluation {
  eligible: boolean;
  evidence: number;
  reasons: string[];
}

/** Evidence = frequency (1 + merges) + reuse (accessCount / 3). */
export function evidenceScore(memory: Memory): number {
  const merges = Number(memory.metadata.mergeCount ?? 0);
  return 1 + merges + Math.floor(memory.accessCount / 3);
}

export function evaluatePromotion(
  memory: Memory,
  criteria: PromotionCriteria,
  now = new Date(),
): PromotionEvaluation {
  const reasons: string[] = [];
  const evidence = evidenceScore(memory);
  if (memory.level === "core") reasons.push("already core");
  if (memory.status !== "active") reasons.push(`status is ${memory.status}`);
  if (memory.scope === "session" || memory.scope === "workspace")
    reasons.push(`${memory.scope} scope is not promotable`);
  if (memory.expiresAt) reasons.push("has expiry");
  if (evidence < criteria.minEvidence)
    reasons.push(`evidence ${evidence} < ${criteria.minEvidence}`);
  if (memory.importance < criteria.minImportance)
    reasons.push(`importance ${memory.importance} < ${criteria.minImportance}`);
  if (memory.confidence < criteria.minConfidence)
    reasons.push(`confidence ${memory.confidence} < ${criteria.minConfidence}`);
  if (memory.accessCount < criteria.minAccessCount)
    reasons.push(`accessCount ${memory.accessCount} < ${criteria.minAccessCount}`);
  const age = now.getTime() - memory.createdAt.getTime();
  if (age < criteria.minAgeMs) reasons.push("too recent");
  return { eligible: reasons.length === 0, evidence, reasons };
}
