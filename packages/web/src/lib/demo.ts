import type { GraphEdge, GraphNode, MemoryGraph } from "./graph";
import type { Memory, Project, RawEvent, Scene, Session, Stats } from "./types";

const now = Date.now();
const h = 3600_000;
const d = 24 * h;
const iso = (t: number) => new Date(t).toISOString();

let n = 0;
const id = (p: string) => `${p}-${String(++n).padStart(3, "0")}-demo-uuid`;

function mem(partial: Partial<Memory> & { content: string }): Memory {
  return {
    id: id("mem"),
    type: "fact",
    level: "atomic",
    scope: "project",
    status: "active",
    projectId: "yoma-connect",
    confidence: 0.85,
    importance: 0.6,
    accessCount: 3,
    createdAt: iso(now - 2 * d),
    updatedAt: iso(now - 2 * h),
    sourceIds: [],
    tags: [],
    sensitive: false,
    metadata: { history: [{ at: iso(now - 2 * d), action: "created" }] },
    ...partial,
  };
}

export const DEMO_PROJECTS: Project[] = [
  {
    id: "yoma-connect",
    name: "yoma-connect",
    description: "Payroll + policy platform (Laravel, Temporal, Node.js)",
    rootPath: "~/dev/yoma-connect",
    createdAt: iso(now - 90 * d),
    updatedAt: iso(now - 2 * 60_000),
    metadata: {},
    memoryCount: 12420,
    sceneCount: 426,
    eventCount: 18402,
    lastActivity: iso(now - 2 * 60_000),
  },
  {
    id: "airmesh",
    name: "airmesh",
    description: "Mesh VPN control plane",
    createdAt: iso(now - 40 * d),
    updatedAt: iso(now - 1 * d),
    metadata: {},
    memoryCount: 320,
    sceneCount: 24,
    eventCount: 512,
    lastActivity: iso(now - 1 * d),
  },
];

const m1 = mem({
  id: "mem-payroll-temporal",
  content: "Payroll generation uses Temporal workflows.",
  type: "architecture",
  level: "core",
  confidence: 0.96,
  importance: 0.92,
  accessCount: 48,
  tags: ["payroll", "temporal"],
  createdAt: iso(now - 20 * d),
  updatedAt: iso(now - 2 * 60_000),
  agent: "claude-code",
  sessionId: "2026-09-19-claude",
  sourceIds: ["evt-002"],
});
const m2 = mem({
  id: "mem-traceparent",
  content: "W3C traceparent is propagated through Temporal headers.",
  type: "fact",
  level: "atomic",
  confidence: 0.91,
  importance: 0.78,
  tags: ["tracing", "temporal"],
  updatedAt: iso(now - 18 * 60_000),
  agent: "claude-code",
  sessionId: "2026-09-19-claude",
  sourceIds: ["evt-003"],
});
const m3 = mem({
  id: "mem-jsonb",
  content: "Policy metadata uses PostgreSQL JSONB.",
  type: "decision",
  level: "atomic",
  confidence: 0.88,
  importance: 0.8,
  tags: ["postgres"],
  updatedAt: iso(now - 42 * 60_000),
  agent: "codex",
  sessionId: "2026-09-19-codex",
  sourceIds: ["evt-001"],
});
const m4 = mem({
  id: "mem-laravel-start",
  content: "Laravel starts the payroll workflow; the Node worker executes activities.",
  type: "architecture",
  level: "atomic",
  confidence: 0.9,
  importance: 0.74,
  updatedAt: iso(now - 5 * h),
  agent: "claude-code",
});
const m5 = mem({
  id: "mem-node-worker",
  content: "Node worker executes Temporal activities and reports heartbeats.",
  type: "fact",
  level: "atomic",
  confidence: 0.87,
  importance: 0.66,
  updatedAt: iso(now - 6 * h),
  agent: "claude-code",
});
const m6 = mem({
  id: "mem-pg15",
  content: "Database uses PostgreSQL 15.",
  type: "fact",
  status: "superseded",
  supersededBy: "mem-pg17",
  confidence: 0.8,
  importance: 0.5,
  createdAt: iso(now - 30 * d),
  updatedAt: iso(now - 12 * d),
});
const m7 = mem({
  id: "mem-pg17",
  content: "Database uses PostgreSQL 17.",
  type: "fact",
  supersedes: "mem-pg15",
  confidence: 0.93,
  importance: 0.62,
  createdAt: iso(now - 12 * d),
  updatedAt: iso(now - 1 * d),
});
const m8 = mem({
  id: "mem-mysql",
  content: "Database uses MySQL.",
  type: "fact",
  status: "conflicted",
  confidence: 0.55,
  importance: 0.4,
  createdAt: iso(now - 25 * d),
  updatedAt: iso(now - 7 * d),
  metadata: {
    history: [{ at: iso(now - 7 * d), action: "conflicted" }],
    conflictsWith: ["mem-pg17"],
  },
});
const m9 = mem({
  id: "mem-dark-mode",
  content: "Prefer dark mode in developer tools; respect prefers-color-scheme.",
  type: "preference",
  level: "core",
  scope: "user",
  projectId: undefined,
  confidence: 0.95,
  importance: 0.7,
  updatedAt: iso(now - 2 * d),
});
const m10 = mem({
  id: "mem-conventional",
  content: "Use Conventional Commits for all repositories.",
  type: "convention",
  level: "core",
  confidence: 0.9,
  importance: 0.72,
  updatedAt: iso(now - 3 * d),
});
const m11 = mem({
  id: "mem-retry",
  content: "Temporal activities retry with exponential backoff, max 5 attempts.",
  type: "lesson",
  confidence: 0.82,
  importance: 0.58,
  updatedAt: iso(now - 9 * h),
});
const m12 = mem({
  id: "mem-airmesh",
  content: "Airmesh peers authenticate with WireGuard preshared keys.",
  type: "architecture",
  projectId: "airmesh",
  confidence: 0.86,
  importance: 0.7,
  updatedAt: iso(now - 1 * d),
});

export const DEMO_MEMORIES: Memory[] = [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12];

export const DEMO_SCENES: Scene[] = [
  {
    id: "scene-payroll",
    name: "Payroll Architecture",
    summary: "Payroll processing is implemented using Laravel, Temporal and Node.js workers.",
    memoryIds: [m1.id, m2.id, m4.id, m5.id],
    projectId: "yoma-connect",
    keywords: ["payroll", "temporal", "laravel"],
    createdAt: iso(now - 19 * d),
    updatedAt: iso(now - 12 * 60_000),
    metadata: {},
  },
  {
    id: "scene-trace",
    name: "Temporal Trace Propagation",
    summary: "Distributed tracing across Laravel → Temporal → Node via W3C traceparent.",
    memoryIds: [m2.id, m4.id],
    projectId: "yoma-connect",
    keywords: ["tracing", "traceparent"],
    createdAt: iso(now - 9 * d),
    updatedAt: iso(now - 1 * h),
    metadata: {},
  },
  {
    id: "scene-auth",
    name: "Authentication Architecture",
    summary: "Session + token auth with short-lived JWTs and refresh rotation.",
    memoryIds: [m12.id],
    projectId: "airmesh",
    keywords: ["auth", "jwt"],
    createdAt: iso(now - 15 * d),
    updatedAt: iso(now - 1 * d),
    metadata: {},
  },
];

export const DEMO_SESSIONS: Session[] = [
  {
    id: "sess-2026-09-19-a",
    sessionId: "2026-09-19-claude",
    projectId: "yoma-connect",
    agent: "claude-code",
    startedAt: iso(now - 3 * h),
    endedAt: iso(now - 2 * h - 18 * 60_000),
    metadata: { messages: 182 },
    eventCount: 34,
    memoryCount: 18,
  },
  {
    id: "sess-2026-09-19-b",
    sessionId: "2026-09-19-codex",
    projectId: "yoma-connect",
    agent: "codex",
    startedAt: iso(now - 5 * h),
    endedAt: iso(now - 4 * h - 20 * 60_000),
    metadata: { messages: 96 },
    eventCount: 21,
    memoryCount: 7,
  },
  {
    id: "sess-2026-09-19-c",
    sessionId: "2026-09-19-gemini",
    projectId: "yoma-connect",
    agent: "gemini",
    startedAt: iso(now - 8 * h),
    endedAt: iso(now - 7 * h - 30 * 60_000),
    metadata: { messages: 44 },
    eventCount: 12,
    memoryCount: 4,
  },
];

export const DEMO_EVENTS: RawEvent[] = [
  {
    id: "evt-001",
    kind: "decision",
    role: "assistant",
    content:
      "Decision: use JSONB for policy metadata to allow schema evolution without migrations.",
    agent: "codex",
    sessionId: "2026-09-19-codex",
    projectId: "yoma-connect",
    createdAt: iso(now - 18 * 60_000),
    metadata: {},
  },
  {
    id: "evt-002",
    kind: "message",
    role: "user",
    content: "Payroll generation should run as Temporal workflows so retries and audits are free.",
    agent: "claude-code",
    sessionId: "2026-09-19-claude",
    projectId: "yoma-connect",
    createdAt: iso(now - 2 * 60_000),
    metadata: {},
  },
  {
    id: "evt-003",
    kind: "commit",
    role: "tool",
    content: "feat: implement trace id propagation through Temporal headers (60e9428)",
    agent: "claude-code",
    sessionId: "2026-09-19-claude",
    projectId: "yoma-connect",
    createdAt: iso(now - 65 * 60_000),
    metadata: { sha: "60e9428" },
  },
  {
    id: "evt-004",
    kind: "note",
    role: "user",
    content: "Architecture decision: Laravel starts workflows, Node workers execute activities.",
    sessionId: "2026-09-19-claude",
    projectId: "yoma-connect",
    createdAt: iso(now - 5 * h),
    metadata: {},
  },
];

export const DEMO_STATS: Stats = {
  memories: 12482,
  byLevel: { atomic: 3820 + 8000, core: 18, scene: 426 },
  byStatus: { active: 12000, superseded: 310, conflicted: 12, archived: 160 },
  byScope: { project: 11200, user: 900, global: 200, workspace: 120, session: 62 },
  byType: {
    fact: 5200,
    decision: 1800,
    architecture: 900,
    convention: 700,
    lesson: 640,
    preference: 420,
    bug_fix: 380,
  },
  events: 18402,
  scenes: 426,
  projects: 7,
  embeddings: 11980,
  dbPath: "~/.ai-memory/memory.db",
  dbSizeBytes: 48 * 1024 * 1024,
};

/* ---------------- demo memory graph (real links between the fixtures) ---------------- */

const gNid = (level: string, ref: string) => `${level}:${ref}`;

export function buildDemoGraph(query?: string): MemoryGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const q = (query ?? "").trim().toLowerCase();
  const match = (text: string) => q.length > 0 && text.toLowerCase().includes(q);

  for (const e of DEMO_EVENTS) {
    nodes.push({
      id: gNid("L0", e.id),
      level: "L0",
      kind: "event",
      refId: e.id,
      label: e.content.slice(0, 90),
      content: e.content,
      type: e.kind,
      status: "active",
      importance: 0.3,
      confidence: 0.5,
      projectId: e.projectId,
      agent: e.agent,
      updatedAt: e.createdAt,
      connectionCount: 0,
      matched: match(e.content),
    });
  }
  for (const m of DEMO_MEMORIES) {
    const lv = m.level === "core" ? "L3" : "L1";
    nodes.push({
      id: gNid(lv, m.id),
      level: lv,
      kind: "memory",
      refId: m.id,
      label: m.content.slice(0, 90),
      content: m.content,
      type: m.type,
      status: m.status,
      importance: m.importance,
      confidence: m.confidence,
      projectId: m.projectId,
      agent: m.agent,
      updatedAt: m.updatedAt,
      connectionCount: 0,
      matched: match(m.content),
    });
  }
  for (const s of DEMO_SCENES) {
    nodes.push({
      id: gNid("L2", s.id),
      level: "L2",
      kind: "scene",
      refId: s.id,
      label: s.name,
      content: s.summary,
      type: "scene",
      status: "active",
      importance: 0.7,
      confidence: 0.8,
      projectId: s.projectId,
      updatedAt: s.updatedAt,
      connectionCount: 0,
      memberCount: s.memoryIds.length,
      matched: match(`${s.name} ${s.summary}`),
    });
  }

  const has = (id: string) => nodes.some((n) => n.id === id);
  const link = (a: string, b: string, type: GraphEdge["type"], strength: number) => {
    if (a !== b && has(a) && has(b))
      edges.push({ id: `${type}:${a}→${b}`, source: a, target: b, type, strength });
  };
  for (const s of DEMO_SCENES) {
    for (const mid of s.memoryIds) {
      const m = DEMO_MEMORIES.find((x) => x.id === mid);
      if (!m) continue;
      const src = gNid(m.level === "core" ? "L3" : "L1", m.id);
      if (m.level === "core") link(gNid("L2", s.id), src, "supports", 0.9);
      else link(src, gNid("L2", s.id), "belongs_to", 0.8);
    }
  }
  for (const m of DEMO_MEMORIES) {
    const src = gNid(m.level === "core" ? "L3" : "L1", m.id);
    for (const sid of m.sourceIds) link(src, gNid("L0", sid), "derived_from", 0.7);
    if (m.supersedes) {
      const o = DEMO_MEMORIES.find((x) => x.id === m.supersedes);
      if (o) link(src, gNid(o.level === "core" ? "L3" : "L1", o.id), "supersedes", 0.85);
    }
    if (m.status === "conflicted") {
      const other = DEMO_MEMORIES.find(
        (x) => x.id !== m.id && x.type === m.type && x.status !== "conflicted",
      );
      if (other)
        link(src, gNid(other.level === "core" ? "L3" : "L1", other.id), "contradicts", 0.8);
    }
  }
  for (const n of nodes) {
    n.connectionCount = edges.filter((e) => e.source === n.id || e.target === n.id).length;
  }
  const strongest = nodes
    .filter((n) => n.level === "L3")
    .sort((a, b) => b.importance - a.importance)[0];
  const most = nodes.slice().sort((a, b) => b.connectionCount - a.connectionCount)[0];
  return {
    nodes,
    edges,
    stats: {
      L0: nodes.filter((n) => n.level === "L0").length,
      L1: nodes.filter((n) => n.level === "L1").length,
      L2: nodes.filter((n) => n.level === "L2").length,
      L3: nodes.filter((n) => n.level === "L3").length,
      edges: edges.length,
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
    },
    totals: { L0: 8420, L1: 3520, L2: 524, L3: 18 },
  };
}
