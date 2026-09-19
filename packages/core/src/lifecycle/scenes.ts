import type { MemoryStore } from "../storage/store.js";
import type { Memory, SceneMemory } from "../types.js";
import { keyTerms, titleCase, truncate } from "../util/text.js";

export interface SceneOptions {
  /** Minimum shared key terms with a scene to join it. */
  minSharedTerms: number;
  /** Minimum sibling memories to spawn a new scene. */
  minClusterSize: number;
  maxKeywords: number;
}

export const DEFAULT_SCENE_OPTIONS: SceneOptions = {
  minSharedTerms: 2,
  minClusterSize: 2,
  maxKeywords: 24,
};

function termFreq(texts: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of texts)
    for (const term of new Set(keyTerms(t))) m.set(term, (m.get(term) ?? 0) + 1);
  return m;
}

function shared(a: Iterable<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

export function buildSceneSummary(name: string, memories: Memory[]): string {
  const lines = memories.slice(0, 5).map((m) => `- ${truncate(m.content, 140)}`);
  return `${memories.length} memor${memories.length === 1 ? "y" : "ies"} about ${name}:\n${lines.join("\n")}`;
}

/** Recompute a scene's keywords (and summary unless custom) from its members. */
export async function refreshScene(
  store: MemoryStore,
  sceneId: string,
  options: SceneOptions = DEFAULT_SCENE_OPTIONS,
): Promise<SceneMemory> {
  const scene = await store.getScene(sceneId);
  if (!scene) throw new Error(`Scene not found: ${sceneId}`);
  const members = await store.getMemories(scene.memoryIds);
  const freq = termFreq(members.map((m) => m.content));
  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, options.maxKeywords)
    .map(([t]) => t);
  return store.updateScene(sceneId, {
    keywords,
    summary: scene.metadata.customSummary ? scene.summary : buildSceneSummary(scene.name, members),
  });
}

export function sceneNameFromTerms(freq: Map<string, number>, memories: Memory[]): string {
  const top = [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([t]) => t);
  if (top.length === 0) return titleCase(keyTerms(memories[0]?.content ?? "scene").slice(0, 3));
  // Prefer the original (unstemmed) spelling from the memory text when possible.
  const originals = new Map<string, string>();
  for (const m of memories) {
    for (const tok of m.content.match(/[\p{L}\p{N}_][\p{L}\p{N}_.\-/]*/gu) ?? []) {
      const k = keyTerms(tok)[0];
      if (k && !originals.has(k)) originals.set(k, tok);
    }
  }
  return titleCase(top.map((t) => originals.get(t) ?? t));
}

/**
 * Attach `memory` to the best matching existing scene, or create a new scene
 * from unclustered siblings. Purely lexical and deterministic; agents that
 * have an LLM can overwrite scene names/summaries via `updateScene`.
 */
export async function assignScene(
  store: MemoryStore,
  memory: Memory,
  options: SceneOptions = DEFAULT_SCENE_OPTIONS,
): Promise<{ scene: SceneMemory; created: boolean } | null> {
  const terms = new Set(keyTerms(memory.content));
  if (terms.size === 0) return null;
  const existingScenes = await store.getScenesForMemory(memory.id);
  if (existingScenes.length > 0) return null;

  const scenes = await store.listScenes({ projectId: memory.projectId, limit: 500 });
  let best: { scene: SceneMemory; n: number } | null = null;
  for (const scene of scenes) {
    if ((scene.projectId ?? null) !== (memory.projectId ?? null)) continue;
    const n = shared(scene.keywords, terms);
    if (n >= options.minSharedTerms && (!best || n > best.n)) best = { scene, n };
  }
  if (best) {
    await store.addSceneMemories(best.scene.id, [memory.id]);
    return { scene: await refreshScene(store, best.scene.id, options), created: false };
  }

  // Try to spawn a scene from similar, unclustered siblings.
  const hits = await store.searchKeyword(
    memory.content,
    { projectId: memory.projectId, allProjects: false },
    15,
  );
  const siblings: Memory[] = [];
  for (const hit of hits) {
    if (hit.id === memory.id) continue;
    const sib = await store.getMemory(hit.id);
    if (!sib || (sib.projectId ?? null) !== (memory.projectId ?? null)) continue;
    if (shared(keyTerms(sib.content), terms) < options.minSharedTerms) continue;
    if ((await store.getScenesForMemory(sib.id)).length > 0) continue;
    siblings.push(sib);
  }
  if (siblings.length < options.minClusterSize) return null;
  const cluster = [memory, ...siblings];
  const freq = termFreq(cluster.map((m) => m.content));
  const name = sceneNameFromTerms(freq, cluster);
  if (await store.getSceneByName(name, memory.projectId)) {
    const existing = (await store.getSceneByName(name, memory.projectId))!;
    await store.addSceneMemories(
      existing.id,
      cluster.map((m) => m.id),
    );
    return { scene: await refreshScene(store, existing.id, options), created: false };
  }
  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, options.maxKeywords)
    .map(([t]) => t);
  const scene = await store.createScene({
    name,
    projectId: memory.projectId,
    keywords,
    memoryIds: cluster.map((m) => m.id),
    summary: buildSceneSummary(name, cluster),
    metadata: { auto: true },
  });
  return { scene, created: true };
}
