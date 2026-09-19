import type { MemoryEngine } from "@ai-agent-memory/core";
import type { Memory, RawEvent, SceneMemory } from "@ai-agent-memory/core";

export type GraphLevel = "L0" | "L1" | "L2" | "L3";
export type GraphEdgeType =
  | "derived_from"
  | "related_to"
  | "belongs_to"
  | "supports"
  | "contradicts"
  | "supersedes"
  | "references";

export interface GraphNode {
  id: string;
  level: GraphLevel;
  /** memory | event | scene */
  kind: "memory" | "event" | "scene";
  /** Underlying memory / event / scene id (without the L0:/L1: prefix). */
  refId: string;
  label: string;
  content: string;
  type: string;
  status: string;
  importance: number;
  confidence: number;
  projectId?: string;
  agent?: string;
  updatedAt: string;
  connectionCount: number;
  /** Scene member count (L2 cluster size). */
  memberCount?: number;
  matched?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  strength: number;
}

export interface GraphStats {
  L0: number;
  L1: number;
  L2: number;
  L3: number;
  edges: number;
  strongestCore?: { id: string; refId: string; label: string };
  mostConnected?: { id: string; refId: string; label: string; connections: number };
}

export interface GraphTotals {
  L0: number;
  L1: number;
  L2: number;
  L3: number;
}

export interface GraphOptions {
  project?: string;
  /** "L0" | "L1" | "L2" | "L3" | "all" (default, L0 only near focus/matches) */
  level?: string;
  query?: string;
  /** Focus memory/event/scene id (raw id or L-prefixed node id): 2-hop neighborhood. */
  focus?: string;
  depth?: number;
  limit?: number;
}

const BASE_STRENGTH: Record<GraphEdgeType, number> = {
  derived_from: 0.7,
  related_to: 0.45,
  belongs_to: 0.8,
  supports: 0.9,
  contradicts: 0.8,
  supersedes: 0.85,
  references: 0.5,
};

const nid = (level: GraphLevel, refId: string) => `${level}:${refId}`;

function strengthOf(type: GraphEdgeType, importance: number, confidence: number): number {
  const w = Math.max(0, Math.min(1, importance, confidence));
  return Math.round((BASE_STRENGTH[type] * (0.55 + 0.45 * w) + Number.EPSILON) * 100) / 100;
}

function clip(content: string, max = 280): string {
  const c = content.replace(/\s+/g, " ").trim();
  return c.length > max ? `${c.slice(0, max - 1)}…` : c;
}

function conflictsOf(m: Memory): string[] {
  const v = m.metadata.conflictsWith;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export async function buildMemoryGraph(
  engine: MemoryEngine,
  options: GraphOptions = {},
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; stats: GraphStats; totals: GraphTotals }> {
  const limit = Math.min(Math.max(options.limit ?? 160, 20), 600);
  const depth = options.depth === 1 ? 1 : 2;
  const level = (options.level ?? "all").toUpperCase();
  const project = options.project || undefined;
  const base = { projectId: project, allProjects: true as const };

  const storeStats = await engine.stats();
  const totals: GraphTotals = {
    L0: storeStats.events,
    L1: storeStats.byLevel.atomic ?? 0,
    L2: storeStats.scenes,
    L3: storeStats.byLevel.core ?? 0,
  };

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const addEdge = (source: string, target: string, type: GraphEdgeType, s: number) => {
    if (source === target || !nodes.has(source) || !nodes.has(target)) return;
    const id = `${type}:${source}→${target}`;
    if (edges.has(id)) return;
    edges.set(id, { id, source, target, type, strength: s });
  };

  const memNode = (m: Memory, matched = false): GraphNode => {
    const lv: GraphLevel = m.level === "core" ? "L3" : "L1";
    return {
      id: nid(lv, m.id),
      level: lv,
      kind: "memory",
      refId: m.id,
      label: clip(m.content, 90),
      content: clip(m.content),
      type: m.type,
      status: m.status,
      importance: m.importance,
      confidence: m.confidence,
      projectId: m.projectId,
      agent: m.agent,
      updatedAt: m.updatedAt.toISOString(),
      connectionCount: 0,
      matched,
    };
  };

  const eventNode = (e: RawEvent): GraphNode => ({
    id: nid("L0", e.id),
    level: "L0",
    kind: "event",
    refId: e.id,
    label: clip(e.content, 90),
    content: clip(e.content),
    type: e.kind,
    status: "active",
    importance: 0.3,
    confidence: 0.5,
    projectId: e.projectId,
    agent: e.agent,
    updatedAt: e.createdAt.toISOString(),
    connectionCount: 0,
  });

  const sceneNode = (s: SceneMemory): GraphNode => ({
    id: nid("L2", s.id),
    level: "L2",
    kind: "scene",
    refId: s.id,
    label: s.name,
    content: clip(s.summary || s.name),
    type: "scene",
    status: "active",
    importance: 0.7,
    confidence: 0.8,
    projectId: s.projectId,
    updatedAt: s.updatedAt.toISOString(),
    connectionCount: 0,
    memberCount: s.memoryIds.length,
  });

  const want = (lv: GraphLevel) => level === "ALL" || level === lv;

  // --- L3: all core memories (the stable backbone) -------------------------
  let cores: Memory[] = [];
  if (want("L3")) {
    cores = await engine.list({
      ...base,
      level: "core",
      limit: 60,
      orderBy: "importance",
      order: "desc",
    });
    for (const m of cores) nodes.set(nid("L3", m.id), memNode(m));
  }

  // --- L2: scenes with the most members ------------------------------------
  let scenes: SceneMemory[] = [];
  if (want("L2")) {
    const all = await engine.listScenes({ projectId: project, allProjects: true, limit: 400 });
    scenes = all
      .sort((a, b) => b.memoryIds.length - a.memoryIds.length)
      .slice(0, level === "L2" ? 80 : 48);
    for (const s of scenes) nodes.set(nid("L2", s.id), sceneNode(s));
  }

  // --- L1: atomic memories ---------------------------------------------------
  const l1ById = new Map<string, Memory>();
  const takeL1 = async (list: Memory[], matchedIds?: Set<string>) => {
    for (const m of list) {
      if (nodes.size >= limit) break;
      if (m.level === "core") {
        if (!nodes.has(nid("L3", m.id)) && want("L3")) nodes.set(nid("L3", m.id), memNode(m));
        continue;
      }
      if (!want("L1") || nodes.has(nid("L1", m.id))) continue;
      nodes.set(nid("L1", m.id), memNode(m, matchedIds?.has(m.id)));
      l1ById.set(m.id, m);
    }
  };

  let matchedIds = new Set<string>();
  if (options.query?.trim()) {
    const hits = await engine
      .search({ query: options.query.trim(), ...base, limit: 14 })
      .catch(() => []);
    matchedIds = new Set(hits.map((h) => h.memory.id));
    await takeL1(
      hits.map((h) => h.memory),
      matchedIds,
    );
  }

  // Members of the chosen scenes (real belongs_to edges).
  if (scenes.length) {
    const wanted = new Set(scenes.flatMap((s) => s.memoryIds).slice(0, 400));
    if (wanted.size) {
      const members = await engine.store.getMemories([...wanted].slice(0, 300));
      members.sort((a, b) => b.importance - a.importance);
      await takeL1(members, matchedIds);
    }
  }

  // Recent / important atomic memories to fill the layer.
  if (want("L1") && (level === "L1" || level === "ALL")) {
    const fill = Math.max(0, Math.min(level === "L1" ? limit : 70, limit - nodes.size));
    if (fill > 0) {
      const recent = await engine.list({
        ...base,
        limit: fill,
        orderBy: "updatedAt",
        order: "desc",
      });
      await takeL1(recent, matchedIds);
    }
  }

  // --- focus mode: 2-hop neighborhood around one node -------------------------
  const focusRaw = (options.focus ?? "").trim();
  if (focusRaw) {
    const focusId = focusRaw.replace(/^(L0|L1|L2|L3):/, "");
    const insp = await engine.inspect(focusId).catch(() => null);
    if (insp) {
      if (!nodes.has(nid("L1", insp.memory.id)) && !nodes.has(nid("L3", insp.memory.id)))
        nodes.set(
          nid(insp.memory.level === "core" ? "L3" : "L1", insp.memory.id),
          memNode(insp.memory, true),
        );
      for (const s of insp.sources.slice(0, 12)) nodes.set(nid("L0", s.id), eventNode(s));
      for (const s of insp.scenes.slice(0, 6)) {
        if (!nodes.has(nid("L2", s.id))) nodes.set(nid("L2", s.id), sceneNode(s));
        if (depth === 2) {
          const siblings = await engine.store.getMemories(s.memoryIds.slice(0, 24));
          for (const m of siblings.slice(0, 12)) {
            const id = nid(m.level === "core" ? "L3" : "L1", m.id);
            if (!nodes.has(id)) nodes.set(id, memNode(m));
          }
        }
      }
      for (const r of insp.related.slice(0, 10)) {
        const id = nid(r.level === "core" ? "L3" : "L1", r.id);
        if (!nodes.has(id)) nodes.set(id, memNode(r));
      }
      for (const m of [insp.supersedes, insp.supersededBy]) {
        if (m) {
          const id = nid(m.level === "core" ? "L3" : "L1", m.id);
          if (!nodes.has(id)) nodes.set(id, memNode(m));
        }
      }
    } else {
      // Maybe a scene or event id.
      const [scene, event] = await Promise.all([
        engine.store.getScene(focusId).catch(() => null),
        engine.getEvent(focusId).catch(() => null),
      ]);
      if (scene) {
        nodes.set(nid("L2", scene.id), sceneNode(scene));
        const members = await engine.store.getMemories(scene.memoryIds.slice(0, 40));
        for (const m of members) {
          const id = nid(m.level === "core" ? "L3" : "L1", m.id);
          if (!nodes.has(id)) nodes.set(id, memNode(m));
        }
      } else if (event) {
        nodes.set(nid("L0", event.id), eventNode(event));
        const derived = await engine.store.getMemoriesForEvent(event.id).catch(() => []);
        for (const m of derived.slice(0, 12)) {
          const id = nid(m.level === "core" ? "L3" : "L1", m.id);
          if (!nodes.has(id)) nodes.set(id, memNode(m));
        }
      }
    }
  }

  // --- L0: events linked from the included L1 memories -------------------------
  const includeL0 =
    want("L0") && (level === "L0" || focusRaw || matchedIds.size > 0 || options.query);
  if (includeL0) {
    const ids = new Set<string>();
    for (const m of l1ById.values()) for (const s of m.sourceIds.slice(0, 3)) ids.add(s);
    // Also pull sources for L1 nodes added via focus/siblings.
    for (const n of nodes.values()) {
      if (n.level !== "L1" || ids.size > 120) break;
      const m = await engine.store.getMemory(n.refId).catch(() => null);
      if (m) for (const s of m.sourceIds.slice(0, 2)) ids.add(s);
    }
    let n = 0;
    for (const id of ids) {
      if (n >= 60 || nodes.size >= limit + 60) break;
      if ([...nodes.values()].some((x) => x.level === "L0" && x.refId === id)) continue;
      const e = await engine.getEvent(id).catch(() => null);
      if (e) {
        nodes.set(nid("L0", e.id), eventNode(e));
        n++;
      }
    }
  }

  // --- edges (only between included nodes; all map to real relations) ---------
  const l1Ids = new Set([...nodes.values()].filter((n) => n.level === "L1").map((n) => n.refId));
  const l3Ids = new Set([...nodes.values()].filter((n) => n.level === "L3").map((n) => n.refId));

  // belongs_to: scene membership (L1/L3 -> L2).
  for (const s of scenes) {
    if (!nodes.has(nid("L2", s.id))) continue;
    const members = await engine.store.getMemories(s.memoryIds.slice(0, 120));
    for (const m of members) {
      const src = nid(m.level === "core" ? "L3" : "L1", m.id);
      if (!nodes.has(src)) continue;
      // Core members support the scene; atomic members belong to it.
      if (m.level === "core")
        addEdge(
          nid("L2", s.id),
          src,
          "supports",
          strengthOf("supports", m.importance, m.confidence),
        );
      else
        addEdge(
          src,
          nid("L2", s.id),
          "belongs_to",
          strengthOf("belongs_to", m.importance, m.confidence),
        );
    }
  }

  // derived_from: memory -> source event (L1/L3 -> L0).
  for (const n of [...nodes.values()]) {
    if ((n.level !== "L1" && n.level !== "L3") || !nodes.size) continue;
    const m = l1ById.get(n.refId) ?? (await engine.store.getMemory(n.refId).catch(() => null));
    if (!m) continue;
    for (const sid of m.sourceIds.slice(0, 4)) {
      const t = nid("L0", sid);
      if (nodes.has(t))
        addEdge(n.id, t, "derived_from", strengthOf("derived_from", m.importance, m.confidence));
    }
  }

  // related_to: L1 pairs sharing a scene or a source (capped).
  const sceneOf = new Map<string, string>();
  for (const s of scenes)
    for (const mid of s.memoryIds) if (!sceneOf.has(mid)) sceneOf.set(mid, s.id);
  const l1List = [...l1Ids];
  let rel = 0;
  const byScene = new Map<string, string[]>();
  for (const id of l1List) {
    const s = sceneOf.get(id);
    if (!s) continue;
    const arr = byScene.get(s) ?? [];
    if (arr.length < 6) arr.push(id);
    byScene.set(s, arr);
  }
  for (const arr of byScene.values()) {
    for (let i = 0; i < arr.length && rel < 60; i++) {
      for (let j = i + 1; j < arr.length && rel < 60; j++) {
        const a = nid("L1", arr[i]!);
        const b = nid("L1", arr[j]!);
        if (nodes.has(a) && nodes.has(b)) {
          addEdge(a, b, "related_to", 0.4);
          rel++;
        }
      }
    }
  }

  // references: L1 pairs from the same session.
  const bySession = new Map<string, string[]>();
  for (const id of l1List) {
    const m = l1ById.get(id) ?? (await engine.store.getMemory(id).catch(() => null));
    if (m?.sessionId) {
      const arr = bySession.get(m.sessionId) ?? [];
      if (arr.length < 5) arr.push(id);
      bySession.set(m.sessionId, arr);
    }
  }
  let refs = 0;
  for (const arr of bySession.values()) {
    for (let i = 0; i < arr.length && refs < 30; i++) {
      for (let j = i + 1; j < arr.length && refs < 30; j++) {
        const a = nid("L1", arr[i]!);
        const b = nid("L1", arr[j]!);
        if (
          nodes.has(a) &&
          nodes.has(b) &&
          ![...edges.values()].some(
            (e) => (e.source === a && e.target === b) || (e.source === b && e.target === a),
          )
        ) {
          addEdge(a, b, "references", 0.5);
          refs++;
        }
      }
    }
  }

  // contradicts + supersedes from stored lifecycle state.
  const allMems = [...l1Ids, ...l3Ids];
  for (const id of allMems) {
    const m = l1ById.get(id) ?? (await engine.store.getMemory(id).catch(() => null));
    if (!m) continue;
    const self = nid(m.level === "core" ? "L3" : "L1", m.id);
    for (const other of conflictsOf(m)) {
      const o = nodes.has(nid("L1", other)) ? nid("L1", other) : nid("L3", other);
      if (nodes.has(o)) addEdge(self, o, "contradicts", 0.8);
    }
    for (const other of [m.supersedes, m.supersededBy]) {
      if (!other) continue;
      const o = nodes.has(nid("L1", other)) ? nid("L1", other) : nid("L3", other);
      if (nodes.has(o)) addEdge(self, o, "supersedes", 0.85);
    }
  }

  // L3 backbone: link core memories that share a scene (supports), capped.
  const coreList = [...l3Ids];
  const coreScene = new Map<string, string>();
  for (const s of scenes)
    for (const mid of s.memoryIds)
      if (coreList.includes(mid) && !coreScene.has(mid)) coreScene.set(mid, s.id);
  const coreByScene = new Map<string, string[]>();
  for (const id of coreList) {
    const s = coreScene.get(id);
    if (!s) continue;
    const arr = coreByScene.get(s) ?? [];
    arr.push(id);
    coreByScene.set(s, arr);
  }
  for (const arr of coreByScene.values()) {
    const sorted = arr.slice(0, 8);
    for (let i = 0; i < sorted.length - 1; i++) {
      addEdge(nid("L3", sorted[i]!), nid("L3", sorted[i + 1]!), "supports", 0.9);
    }
  }

  // connection counts + trim isolates (keep matched + L3 + L2 always).
  for (const e of edges.values()) {
    const a = nodes.get(e.source);
    const b = nodes.get(e.target);
    if (a) a.connectionCount++;
    if (b) b.connectionCount++;
  }
  for (const [id, n] of [...nodes]) {
    if (n.connectionCount === 0 && !n.matched && n.level !== "L3" && n.level !== "L2")
      nodes.delete(id);
  }
  for (const [id, e] of [...edges]) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) edges.delete(id);
  }

  const nodeArr = [...nodes.values()];
  const edgeArr = [...edges.values()];
  const strongest = nodeArr
    .filter((n) => n.level === "L3")
    .sort((a, b) => b.importance - a.importance)[0];
  const most = nodeArr.slice().sort((a, b) => b.connectionCount - a.connectionCount)[0];
  const stats: GraphStats = {
    L0: nodeArr.filter((n) => n.level === "L0").length,
    L1: nodeArr.filter((n) => n.level === "L1").length,
    L2: nodeArr.filter((n) => n.level === "L2").length,
    L3: nodeArr.filter((n) => n.level === "L3").length,
    edges: edgeArr.length,
    ...(strongest
      ? { strongestCore: { id: strongest.id, refId: strongest.refId, label: strongest.label } }
      : {}),
    ...(most && most.connectionCount > 0
      ? {
          mostConnected: {
            id: most.id,
            refId: most.refId,
            label: most.label,
            connections: most.connectionCount,
          },
        }
      : {}),
  };
  return { nodes: nodeArr, edges: edgeArr, stats, totals };
}
