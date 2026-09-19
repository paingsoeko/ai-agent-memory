/**
 * Core domain types for @ai-memory.
 *
 * Memory layers:
 *   L0 raw events   -> RawEvent  (events table; provenance, never rewritten)
 *   L1 atomic       -> Memory with level "atomic"
 *   L2 scene        -> SceneMemory (groups of atomic memories)
 *   L3 core         -> Memory with level "core" (promoted atomic memory)
 */

export const BUILTIN_MEMORY_TYPES = [
  "fact",
  "preference",
  "decision",
  "architecture",
  "convention",
  "pattern",
  "bug_fix",
  "lesson",
  "task",
  "constraint",
  "persona",
  "project_context",
  "summary",
] as const;

export type BuiltinMemoryType = (typeof BUILTIN_MEMORY_TYPES)[number];

/** Built-in memory types plus any custom string type. */
export type MemoryType = BuiltinMemoryType | (string & {});

export const MEMORY_SCOPES = ["global", "user", "project", "workspace", "session"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

/** Rank of each scope in the hierarchy (lower = broader). */
export const SCOPE_RANK: Record<MemoryScope, number> = {
  global: 0,
  user: 1,
  project: 2,
  workspace: 3,
  session: 4,
};

export type MemoryLevel = "atomic" | "core";

export type MemoryStatus = "active" | "superseded" | "conflicted" | "archived";

export type EventKind =
  | "message"
  | "tool_result"
  | "task_summary"
  | "commit"
  | "error"
  | "decision"
  | "external"
  | "note"
  | (string & {});

export type EventRole = "user" | "assistant" | "system" | "tool";

export interface RawEvent {
  id: string;
  kind: EventKind;
  role?: EventRole;
  content: string;
  agent?: string;
  sessionId?: string;
  projectId?: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface Memory {
  id: string;
  content: string;
  type: MemoryType;
  level: MemoryLevel;
  scope: MemoryScope;
  status: MemoryStatus;
  projectId?: string;
  workspaceId?: string;
  sessionId?: string;
  userId?: string;
  agent?: string;
  confidence: number;
  importance: number;
  accessCount: number;
  lastAccessedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  supersedes?: string;
  supersededBy?: string;
  /** Raw event ids this memory was derived from (L0 provenance). */
  sourceIds: string[];
  tags: string[];
  /** Content hash used for exact-duplicate detection. */
  contentHash: string;
  /** Marks memory as sensitive: never sent to network embedding providers. */
  sensitive: boolean;
  metadata: Record<string, unknown>;
}

/** The atomic-memory view described in the spec (subset of Memory). */
export type AtomicMemory = Pick<
  Memory,
  | "id"
  | "content"
  | "type"
  | "projectId"
  | "scope"
  | "confidence"
  | "importance"
  | "sourceIds"
  | "createdAt"
  | "updatedAt"
  | "expiresAt"
>;

export interface SceneMemory {
  id: string;
  name: string;
  summary: string;
  memoryIds: string[];
  projectId?: string;
  keywords: string[];
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  rootPath?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface Session {
  id: string;
  projectId?: string;
  agent?: string;
  startedAt: Date;
  endedAt?: Date;
  metadata: Record<string, unknown>;
}

export interface MemoryResult {
  memory: Memory;
  score: number;
  source: "keyword" | "semantic" | "hybrid";
  explanation?: string;
}

export interface MemoryInspection {
  memory: Memory;
  sources: RawEvent[];
  scenes: SceneMemory[];
  supersedes: Memory | null;
  supersededBy: Memory | null;
  related: Memory[];
  /** Lifecycle history entries recorded in metadata.history */
  history: MemoryHistoryEntry[];
}

export interface MemoryHistoryEntry {
  at: string;
  action:
    | "created"
    | "merged"
    | "updated"
    | "promoted"
    | "demoted"
    | "superseded"
    | "conflicted"
    | "archived"
    | "restored"
    | (string & {});
  detail?: string;
  relatedId?: string;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface RememberInput {
  content: string;
  type?: MemoryType;
  scope?: MemoryScope;
  /** Project name/id. Alias: `project`. */
  projectId?: string;
  project?: string;
  workspaceId?: string;
  sessionId?: string;
  userId?: string;
  agent?: string;
  confidence?: number;
  importance?: number;
  tags?: string[];
  sourceIds?: string[];
  expiresAt?: Date | string;
  /** Time to live in milliseconds (alternative to expiresAt). */
  ttlMs?: number;
  sensitive?: boolean;
  metadata?: Record<string, unknown>;
  /** Attach memory to a named scene (created if missing). */
  scene?: string;
  /** Skip deduplication/conflict detection and always insert. */
  force?: boolean;
}

export interface RememberResult {
  memory: Memory;
  /** What the lifecycle decided to do with the input. */
  action: "created" | "merged" | "superseded" | "conflicted";
  /** The memory that was merged into / superseded, if any. */
  relatedId?: string;
  similarity?: number;
}

export interface MemoryFilter {
  projectId?: string;
  /** Include memories from all projects (disables project isolation). */
  allProjects?: boolean;
  scope?: MemoryScope | MemoryScope[];
  type?: MemoryType | MemoryType[];
  level?: MemoryLevel | MemoryLevel[];
  status?: MemoryStatus | MemoryStatus[];
  sessionId?: string;
  workspaceId?: string;
  userId?: string;
  agent?: string;
  tags?: string[];
  /** Include expired memories (default false). */
  includeExpired?: boolean;
  minImportance?: number;
  minConfidence?: number;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface ListOptions extends MemoryFilter {
  limit?: number;
  offset?: number;
  orderBy?: "createdAt" | "updatedAt" | "importance" | "accessCount" | "lastAccessedAt";
  order?: "asc" | "desc";
}

export interface SearchOptions extends MemoryFilter {
  query: string;
  limit?: number;
  offset?: number;
  /** "keyword" | "semantic" | "hybrid" (default: hybrid when embeddings enabled). */
  mode?: "keyword" | "semantic" | "hybrid";
  /** Number of candidates retrieved from each ranker before fusion. */
  candidateLimit?: number;
}

export interface RecallOptions extends SearchOptions {
  /** Always include top core memories for the project even if not matched. */
  includeCore?: boolean;
  /** Record access statistics for returned memories (default true). */
  trackAccess?: boolean;
}

export interface UpdateMemoryInput {
  content?: string;
  type?: MemoryType;
  scope?: MemoryScope;
  projectId?: string | null;
  confidence?: number;
  importance?: number;
  tags?: string[];
  expiresAt?: Date | string | null;
  status?: MemoryStatus;
  level?: MemoryLevel;
  sensitive?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ForgetOptions {
  /** Archive instead of deleting (default false = hard delete of the memory row; raw events are kept). */
  archive?: boolean;
}

export interface IngestMessage {
  role: EventRole;
  content: string;
  kind?: EventKind;
  createdAt?: Date | string;
  metadata?: Record<string, unknown>;
}

export interface ExtractedCandidate {
  content: string;
  type: MemoryType;
  confidence: number;
  importance: number;
  scope?: MemoryScope;
  tags?: string[];
  /** Index of the source message in the ingest batch. */
  messageIndex: number;
  reason: string;
}

/**
 * Pluggable extractor. Agents that have an LLM available can supply their own
 * extractor (the engine stays vendor-neutral); the default is heuristic.
 */
export type MemoryExtractor = (
  messages: IngestMessage[],
  context: { projectId?: string; sessionId?: string; agent?: string },
) => Promise<ExtractedCandidate[]> | ExtractedCandidate[];

export interface IngestInput {
  messages: IngestMessage[];
  sessionId?: string;
  agent?: string;
  projectId?: string;
  project?: string;
  workspaceId?: string;
  /** Override the extractor for this batch. */
  extractor?: MemoryExtractor;
  /** Minimum confidence for a candidate to be stored (default from config). */
  minConfidence?: number;
  /** Store raw events only, do not extract. */
  rawOnly?: boolean;
  /** Skip storing raw events (extraction only). */
  skipEvents?: boolean;
}

export interface IngestResult {
  events: RawEvent[];
  candidates: ExtractedCandidate[];
  results: RememberResult[];
  skipped: number;
}

export interface ExportData {
  version: 1;
  exportedAt: string;
  projects: Project[];
  sessions: Session[];
  events: RawEvent[];
  memories: Memory[];
  scenes: SceneMemory[];
  embeddings?: { memoryId: string; model: string; vector: number[] }[];
}

export interface ImportOptions {
  /** Overwrite existing rows with the same id (default false = skip). */
  overwrite?: boolean;
  includeEmbeddings?: boolean;
}

export interface ImportResult {
  projects: number;
  sessions: number;
  events: number;
  memories: number;
  scenes: number;
  embeddings: number;
  skipped: number;
}

export interface MemoryStats {
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

export interface ConsolidateResult {
  promoted: string[];
  demoted: string[];
  expired: string[];
  scenesCreated: string[];
  scenesUpdated: string[];
  embedded: number;
}
