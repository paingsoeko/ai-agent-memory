import type {
  ExportData,
  ListOptions,
  Memory,
  MemoryFilter,
  MemoryStats,
  Project,
  RawEvent,
  SceneMemory,
  Session,
} from "../types.js";

export interface CreateEventInput {
  id?: string;
  kind: RawEvent["kind"];
  role?: RawEvent["role"];
  content: string;
  agent?: string;
  sessionId?: string;
  projectId?: string;
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface EventFilter {
  projectId?: string;
  sessionId?: string;
  kind?: string;
  agent?: string;
  limit?: number;
  offset?: number;
}

export type CreateMemoryRecord = Omit<Memory, "createdAt" | "updatedAt" | "accessCount"> & {
  createdAt?: Date;
  updatedAt?: Date;
  accessCount?: number;
};

export type MemoryPatch = Partial<Omit<Memory, "id" | "createdAt">> & { clearExpiresAt?: boolean };

export interface ScoredId {
  id: string;
  score: number;
}

export interface CreateSceneInput {
  id?: string;
  name: string;
  summary?: string;
  projectId?: string;
  keywords?: string[];
  memoryIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface EmbeddingRow {
  memoryId: string;
  model: string;
  vector: Float32Array;
}

/**
 * Storage abstraction. The engine only talks to this interface, so alternative
 * backends (Postgres, encrypted SQLite, remote) can be plugged in without
 * touching the memory logic. All methods are async even when the backend is
 * synchronous.
 */
export interface MemoryStore {
  readonly kind: string;
  readonly location: string;

  init(): Promise<void>;
  close(): Promise<void>;

  // --- transactions -------------------------------------------------------
  transaction<T>(fn: () => Promise<T> | T): Promise<T>;

  // --- L0 events ----------------------------------------------------------
  createEvent(input: CreateEventInput): Promise<RawEvent>;
  createEvents(inputs: CreateEventInput[]): Promise<RawEvent[]>;
  getEvent(id: string): Promise<RawEvent | null>;
  listEvents(filter?: EventFilter): Promise<RawEvent[]>;
  countEvents(filter?: EventFilter): Promise<number>;

  // --- memories -----------------------------------------------------------
  createMemory(record: CreateMemoryRecord): Promise<Memory>;
  getMemory(id: string): Promise<Memory | null>;
  getMemories(ids: string[]): Promise<Memory[]>;
  /** Resolve a possibly-abbreviated id (prefix). Returns all matches. */
  resolveMemoryId(prefix: string): Promise<string[]>;
  updateMemory(id: string, patch: MemoryPatch): Promise<Memory>;
  deleteMemory(id: string): Promise<void>;
  list(options?: ListOptions): Promise<Memory[]>;
  count(filter?: MemoryFilter): Promise<number>;
  findByHash(hash: string, filter?: MemoryFilter): Promise<Memory[]>;
  recordAccess(ids: string[], at?: Date): Promise<void>;

  /** Keyword search (FTS5 / full-text). Returns higher-is-better scores. */
  searchKeyword(query: string, filter: MemoryFilter, limit: number): Promise<ScoredId[]>;
  /** Vector similarity search over stored embeddings for `model`. */
  searchVector(
    vector: Float32Array,
    model: string,
    filter: MemoryFilter,
    limit: number,
  ): Promise<ScoredId[]>;

  // --- provenance ---------------------------------------------------------
  addSources(memoryId: string, eventIds: string[]): Promise<void>;
  getSources(memoryId: string): Promise<RawEvent[]>;
  getMemoriesForEvent(eventId: string): Promise<Memory[]>;

  // --- embeddings ---------------------------------------------------------
  setEmbedding(memoryId: string, model: string, vector: Float32Array): Promise<void>;
  setEmbeddings(rows: EmbeddingRow[]): Promise<void>;
  getEmbedding(memoryId: string, model: string): Promise<Float32Array | null>;
  listMemoriesWithoutEmbedding(
    model: string,
    limit: number,
    filter?: MemoryFilter,
  ): Promise<Memory[]>;
  deleteEmbeddings(model?: string): Promise<number>;
  countEmbeddings(model?: string): Promise<number>;
  listEmbeddings(model?: string): Promise<EmbeddingRow[]>;

  // --- scenes -------------------------------------------------------------
  createScene(input: CreateSceneInput): Promise<SceneMemory>;
  getScene(id: string): Promise<SceneMemory | null>;
  getSceneByName(name: string, projectId?: string): Promise<SceneMemory | null>;
  updateScene(
    id: string,
    patch: Partial<Pick<SceneMemory, "name" | "summary" | "keywords" | "metadata" | "projectId">>,
  ): Promise<SceneMemory>;
  deleteScene(id: string): Promise<void>;
  listScenes(filter?: {
    projectId?: string;
    allProjects?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<SceneMemory[]>;
  addSceneMemories(sceneId: string, memoryIds: string[]): Promise<void>;
  removeSceneMemory(sceneId: string, memoryId: string): Promise<void>;
  getScenesForMemory(memoryId: string): Promise<SceneMemory[]>;

  // --- projects / sessions ------------------------------------------------
  upsertProject(input: {
    name: string;
    id?: string;
    description?: string;
    rootPath?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Project>;
  getProject(idOrName: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;
  deleteProject(idOrName: string): Promise<void>;
  upsertSession(input: {
    id: string;
    projectId?: string;
    agent?: string;
    startedAt?: Date;
    endedAt?: Date;
    metadata?: Record<string, unknown>;
  }): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  listSessions(filter?: { projectId?: string; limit?: number }): Promise<Session[]>;

  // --- maintenance --------------------------------------------------------
  stats(): Promise<MemoryStats>;
  exportAll(options?: { includeEmbeddings?: boolean }): Promise<ExportData>;
  vacuum(): Promise<void>;
}
