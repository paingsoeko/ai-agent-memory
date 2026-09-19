import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

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
  kind: "memory" | "event" | "scene";
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

export interface MemoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  totals: GraphTotals;
}

export const LEVEL_ORDER: GraphLevel[] = ["L0", "L1", "L2", "L3"];

export const NODE_RADIUS: Record<GraphLevel, number> = { L0: 5, L1: 9, L2: 15, L3: 24 };

/* ---------------- force layout ---------------- */

interface SimNode extends SimulationNodeDatum {
  id: string;
  level: GraphLevel;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  strength: number;
}

/**
 * Layer-biased force layout. Runs synchronously to a settled state (no idle
 * animation), so the network feels calm and stays at 60fps during pan/zoom.
 * Seeded initial positions keep repeated renders stable.
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width = 1200,
  height = 800,
): Map<string, { x: number; y: number }> {
  const bands: Record<GraphLevel, number> = {
    L0: height * 0.12,
    L1: height * 0.36,
    L2: height * 0.62,
    L3: height * 0.86,
  };
  const byLevel = new Map<GraphLevel, number>();
  const simNodes: SimNode[] = nodes.map((n) => {
    const i = byLevel.get(n.level) ?? 0;
    byLevel.set(n.level, i + 1);
    const count = Math.max(1, nodes.filter((m) => m.level === n.level).length);
    return {
      id: n.id,
      level: n.level,
      // Golden-angle spread: organic but deterministic, no chaotic overlap.
      x: width / 2 + Math.cos(i * 2.39996) * (60 + ((i * 53) % Math.max(80, width / 3))),
      y: bands[n.level] + Math.sin(i * 2.39996) * 46 * (count > 12 ? 1.6 : 1),
    };
  });
  const byId = new Map(simNodes.map((n) => [n.id, n]));
  const simLinks: SimLink[] = [];
  for (const e of edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (s && t) simLinks.push({ source: s, target: t, strength: e.strength });
  }

  const sim = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .distance((l) => 110 - l.strength * 60)
        .strength((l) => 0.25 + l.strength * 0.65),
    )
    .force(
      "charge",
      forceManyBody<SimNode>().strength((n) =>
        n.level === "L3" ? -260 : n.level === "L2" ? -140 : -60,
      ),
    )
    .force("collide", forceCollide<SimNode>((n) => NODE_RADIUS[n.level] + 7).iterations(2))
    .force("layerY", forceY<SimNode>((n) => bands[n.level]).strength(0.32))
    .force("centerX", forceX<SimNode>(width / 2).strength(0.06))
    .stop();
  // Fixed tick budget: deterministic settle, then fully static.
  for (let i = 0; i < 260; i++) sim.tick();

  const out = new Map<string, { x: number; y: number }>();
  for (const n of simNodes) out.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  return out;
}

/* ---------------- graph queries ---------------- */

export function adjacency(edges: GraphEdge[]): Map<string, { to: string; edge: GraphEdge }[]> {
  const map = new Map<string, { to: string; edge: GraphEdge }[]>();
  const add = (from: string, to: string, edge: GraphEdge) => {
    const arr = map.get(from) ?? [];
    arr.push({ to, edge });
    map.set(from, arr);
  };
  for (const e of edges) {
    add(e.source, e.target, e);
    add(e.target, e.source, e);
  }
  return map;
}

/** 1-hop + 2-hop neighborhood ids around `root` (includes root). */
export function neighborhood(edges: GraphEdge[], root: string, hops = 2): Set<string> {
  const adj = adjacency(edges);
  const seen = new Set<string>([root]);
  let frontier = [root];
  for (let h = 0; h < hops; h++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const { to } of adj.get(id) ?? []) {
        if (!seen.has(to)) {
          seen.add(to);
          next.push(to);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * Retrieval path: shortest path from `from` following edges upward to the
 * nearest L3 (falls back to nearest L2). Returns node + edge id sets.
 */
export function retrievalPath(
  nodes: GraphNode[],
  edges: GraphEdge[],
  from: string,
): { nodes: Set<string>; edges: Set<string>; target: GraphNode | null } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = adjacency(edges);
  const prev = new Map<string, { via: string; edge: string }>();
  const seen = new Set<string>([from]);
  const queue = [from];
  let target: GraphNode | null = null;
  let l2fallback: GraphNode | null = null;
  while (queue.length) {
    const cur = queue.shift()!;
    const n = byId.get(cur);
    if (n && n.id !== from) {
      if (n.level === "L3") {
        target = n;
        break;
      }
      if (!l2fallback && n.level === "L2") l2fallback = n;
    }
    for (const { to, edge } of adj.get(cur) ?? []) {
      if (!seen.has(to)) {
        seen.add(to);
        prev.set(to, { via: cur, edge: edge.id });
        queue.push(to);
      }
    }
  }
  target = target ?? l2fallback;
  const pathNodes = new Set<string>([from]);
  const pathEdges = new Set<string>();
  if (target) {
    let cur: string | undefined = target.id;
    pathNodes.add(cur);
    while (cur && cur !== from) {
      const p = prev.get(cur);
      if (!p) break;
      pathEdges.add(p.edge);
      pathNodes.add(p.via);
      cur = p.via;
    }
  }
  return { nodes: pathNodes, edges: pathEdges, target };
}

/** Union of retrieval paths for every matched node. */
export function matchedPaths(graph: MemoryGraph): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const n of graph.nodes) {
    if (!n.matched) continue;
    const p = retrievalPath(graph.nodes, graph.edges, n.id);
    for (const id of p.nodes) nodes.add(id);
    for (const id of p.edges) edges.add(id);
  }
  return { nodes, edges };
}
