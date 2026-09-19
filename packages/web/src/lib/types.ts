export interface Memory {
  id: string;
  content: string;
  type: string;
  level: "atomic" | "core";
  scope: string;
  status: "active" | "superseded" | "conflicted" | "archived";
  projectId?: string;
  workspaceId?: string;
  sessionId?: string;
  agent?: string;
  confidence: number;
  importance: number;
  accessCount: number;
  lastAccessedAt?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  supersedes?: string;
  supersededBy?: string;
  sourceIds: string[];
  tags: string[];
  sensitive: boolean;
  metadata: Record<string, unknown>;
}

export interface RawEvent {
  id: string;
  kind: string;
  role?: string;
  content: string;
  agent?: string;
  sessionId?: string;
  projectId?: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface Scene {
  id: string;
  name: string;
  summary: string;
  memoryIds: string[];
  projectId?: string;
  keywords: string[];
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  members?: Memory[];
  coreCount?: number;
  atomicCount?: number;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  rootPath?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  memoryCount?: number;
  sceneCount?: number;
  eventCount?: number;
  lastActivity?: string;
}

export interface Session {
  id: string;
  sessionId: string;
  projectId?: string;
  agent?: string;
  startedAt: string;
  endedAt?: string;
  metadata: Record<string, unknown>;
  eventCount?: number;
  memoryCount?: number;
  events?: RawEvent[];
  memories?: Memory[];
}

export interface MemoryInspection {
  memory: Memory;
  sources: RawEvent[];
  scenes: Scene[];
  supersedes: Memory | null;
  supersededBy: Memory | null;
  related: Memory[];
  history: { at: string; action: string; detail?: string; relatedId?: string }[];
}

export interface SearchResult {
  memory: Memory;
  score: number;
  source: "keyword" | "semantic" | "hybrid";
  explanation?: string;
  matched?: string[];
}

export interface Page<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore?: boolean;
}

export interface Stats {
  memories: number;
  byLevel: Record<string, number>;
  byStatus: Record<string, number>;
  byScope: Record<string, number>;
  byType: Record<string, number>;
  events: number;
  scenes: number;
  projects: number;
  embeddings: number;
  dbPath?: string;
  dbSizeBytes?: number;
}

export interface ActivityItem {
  kind: "event" | "memory";
  at: string;
  title: string;
  detail: string;
  agent: string | null;
  sessionId: string | null;
  projectId: string | null;
  refId: string;
}

export type Route =
  | { name: "overview" }
  | { name: "memories" }
  | { name: "network" }
  | { name: "scenes" }
  | { name: "scene"; id: string }
  | { name: "core" }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "sessions" }
  | { name: "session"; id: string }
  | { name: "sources" }
  | { name: "source"; id: string }
  | { name: "search"; q?: string }
  | { name: "settings" };
