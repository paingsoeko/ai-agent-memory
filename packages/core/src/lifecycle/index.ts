export { detectDuplicateOrConflict, type DedupDecision, type DedupOptions } from "./dedup.js";
export { parseStatement, statementsConflict, negationConflict } from "./conflict.js";
export { evaluatePromotion, evidenceScore, type PromotionEvaluation } from "./promotion.js";
export {
  assignScene,
  refreshScene,
  buildSceneSummary,
  sceneNameFromTerms,
  DEFAULT_SCENE_OPTIONS,
  type SceneOptions,
} from "./scenes.js";
