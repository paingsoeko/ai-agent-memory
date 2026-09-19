import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { SQLInputValue } from "node:sqlite";
import { MemoryError, NotFoundError } from "../../errors.js";
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
} from "../../types.js";
import { newId, nowIso, toDate } from "../../util/ids.js";
import { cosine } from "../../util/text.js";
import type {
  CreateEventInput,
  CreateMemoryRecord,
  CreateSceneInput,
  EmbeddingRow,
  EventFilter,
  MemoryPatch,
  MemoryStore,
  ScoredId,
} from "../store.js";
import { loadSqlite, type SqliteDatabase } from "./driver.js";
import { buildFtsQuery } from "./fts.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

export interface SQLiteStoreOptions {
  /** File path or ":memory:". */
  path: string;
  /** Open read-only (default false). */
  readonly?: boolean;
  /** Enable WAL journal mode for file databases (default true). */
  wal?: boolean;
}

type Row = Record<string, SQLInputValue | Uint8Array | null | undefined>;

const iso = (d: Date | undefined) => (d ? d.toISOString() : null);
const parseJson = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== "string" || !s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

function rowToMemory(r: Row): Memory {
  return {
    id: String(r.id),
    content: String(r.content),
    type: String(r.type),
    level: r.level as Memory["level"],
    scope: r.scope as Memory["scope"],
    status: r.status as Memory["status"],
    projectId: (r.project_id as string | null) ?? undefined,
    workspaceId: (r.workspace_id as string | null) ?? undefined,
    sessionId: (r.session_id as string | null) ?? undefined,
    userId: (r.user_id as string | null) ?? undefined,
    agent: (r.agent as string | null) ?? undefined,
    confidence: Number(r.confidence),
    importance: Number(r.importance),
    accessCount: Number(r.access_count ?? 0),
    lastAccessedAt: toDate(r.last_accessed_at as string | null),
    createdAt: toDate(r.created_at as string)!,
    updatedAt: toDate(r.updated_at as string)!,
    expiresAt: toDate(r.expires_at as string | null),
    supersedes: (r.supersedes as string | null) ?? undefined,
    supersededBy: (r.superseded_by as string | null) ?? undefined,
    sourceIds: parseJson<string[]>(r.source_ids, []),
    tags: parseJson<string[]>(r.tags, []),
    contentHash: String(r.content_hash),
    sensitive: Number(r.sensitive ?? 0) === 1,
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
  };
}

function rowToEvent(r: Row): RawEvent {
  return {
    id: String(r.id),
    kind: String(r.kind),
    role: (r.role as RawEvent["role"] | null) ?? undefined,
    content: String(r.content),
    agent: (r.agent as string | null) ?? undefined,
    sessionId: (r.session_id as string | null) ?? undefined,
    projectId: (r.project_id as string | null) ?? undefined,
    createdAt: toDate(r.created_at as string)!,
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
  };
}

function rowToScene(r: Row, memoryIds: string[]): SceneMemory {
  return {
    id: String(r.id),
    name: String(r.name),
    summary: String(r.summary ?? ""),
    projectId: (r.project_id as string | null) ?? undefined,
    keywords: parseJson<string[]>(r.keywords, []),
    memoryIds,
    createdAt: toDate(r.created_at as string)!,
    updatedAt: toDate(r.updated_at as string)!,
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
  };
}

function rowToProject(r: Row): Project {
  return {
    id: String(r.id),
    name: String(r.name),
    description: (r.description as string | null) ?? undefined,
    rootPath: (r.root_path as string | null) ?? undefined,
    createdAt: toDate(r.created_at as string)!,
    updatedAt: toDate(r.updated_at as string)!,
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
  };
}

function rowToSession(r: Row): Session {
  return {
    id: String(r.id),
    projectId: (r.project_id as string | null) ?? undefined,
    agent: (r.agent as string | null) ?? undefined,
    startedAt: toDate(r.started_at as string)!,
    endedAt: toDate(r.ended_at as string | null),
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
  };
}

const MEMORY_SELECT = `SELECT m.*, (SELECT json_group_array(event_id) FROM memory_sources s WHERE s.memory_id = m.id) AS source_ids FROM memories m`;

const arr = <T>(v: T | T[] | undefined): T[] | undefined =>
  v === undefined ? undefined : Array.isArray(v) ? v : [v];

/**
 * Compile a MemoryFilter into a SQL WHERE fragment over alias `m`.
 * Project isolation: memories are only visible for their own project (plus
 * project-less global/user memories) unless `allProjects` is set.
 */
export function compileFilter(
  filter: MemoryFilter = {},
  opts: { defaultStatus?: Memory["status"][] } = {},
) {
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  if (!filter.allProjects) {
    if (filter.projectId) {
      where.push("(m.project_id = ? OR m.project_id IS NULL)");
      params.push(filter.projectId);
    } else {
      where.push("m.project_id IS NULL");
    }
  } else if (filter.projectId) {
    where.push("(m.project_id = ? OR m.project_id IS NULL)");
    params.push(filter.projectId);
  }
  const inList = (col: string, values: string[] | undefined) => {
    if (!values || values.length === 0) return;
    where.push(`m.${col} IN (${values.map(() => "?").join(",")})`);
    params.push(...values);
  };
  inList("scope", arr(filter.scope));
  inList("type", arr(filter.type));
  inList("level", arr(filter.level));
  const status = arr(filter.status) ?? opts.defaultStatus ?? ["active", "conflicted"];
  inList("status", status);
  if (filter.sessionId) {
    where.push("m.session_id = ?");
    params.push(filter.sessionId);
  }
  if (filter.workspaceId) {
    where.push("m.workspace_id = ?");
    params.push(filter.workspaceId);
  }
  if (filter.userId) {
    where.push("m.user_id = ?");
    params.push(filter.userId);
  }
  if (filter.agent) {
    where.push("m.agent = ?");
    params.push(filter.agent);
  }
  if (!filter.includeExpired) {
    where.push("(m.expires_at IS NULL OR m.expires_at > ?)");
    params.push(nowIso());
  }
  if (filter.minImportance !== undefined) {
    where.push("m.importance >= ?");
    params.push(filter.minImportance);
  }
  if (filter.minConfidence !== undefined) {
    where.push("m.confidence >= ?");
    params.push(filter.minConfidence);
  }
  if (filter.createdAfter) {
    where.push("m.created_at >= ?");
    params.push(filter.createdAfter.toISOString());
  }
  if (filter.createdBefore) {
    where.push("m.created_at <= ?");
    params.push(filter.createdBefore.toISOString());
  }
  if (filter.tags && filter.tags.length > 0) {
    for (const tag of filter.tags) {
      where.push("EXISTS (SELECT 1 FROM json_each(m.tags) t WHERE t.value = ?)");
      params.push(tag);
    }
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export class SQLiteStore implements MemoryStore {
  readonly kind = "sqlite";
  readonly location: string;
  private db: SqliteDatabase | null = null;
  private txDepth = 0;
  private readonly options: SQLiteStoreOptions;

  constructor(options: SQLiteStoreOptions) {
    this.options = options;
    this.location = options.path;
  }

  static async open(options: SQLiteStoreOptions): Promise<SQLiteStore> {
    const store = new SQLiteStore(options);
    await store.init();
    return store;
  }

  private get conn(): SqliteDatabase {
    if (!this.db) throw new MemoryError("STORAGE", "Store is not initialized. Call init() first.");
    return this.db;
  }

  async init(): Promise<void> {
    if (this.db) return;
    const DatabaseSync = await loadSqlite();
    const path = this.options.path;
    if (path !== ":memory:") {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    try {
      this.db = new DatabaseSync(path, { readOnly: this.options.readonly ?? false });
    } catch (err) {
      throw new MemoryError(
        "STORAGE",
        `Could not open SQLite database at ${path}: ${(err as Error).message}`,
        "Check the path is writable, or run `aam init`.",
      );
    }
    const db = this.db;
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA foreign_keys = ON");
    if (path !== ":memory:" && (this.options.wal ?? true) && !this.options.readonly) {
      try {
        db.exec("PRAGMA journal_mode = WAL");
        db.exec("PRAGMA synchronous = NORMAL");
      } catch {
        /* WAL unavailable on some filesystems; fall back silently */
      }
    }
    if (!this.options.readonly) {
      db.exec(SCHEMA_SQL);
      const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
        Row | undefined;
      if (!row) {
        db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?)").run(
          String(SCHEMA_VERSION),
        );
        db.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES ('created_at', ?)").run(nowIso());
      }
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // --- transactions ---------------------------------------------------------

  async transaction<T>(fn: () => Promise<T> | T): Promise<T> {
    const db = this.conn;
    const depth = this.txDepth++;
    const sp = `sp_${depth}`;
    if (depth === 0) db.exec("BEGIN IMMEDIATE");
    else db.exec(`SAVEPOINT ${sp}`);
    try {
      const result = await fn();
      if (depth === 0) db.exec("COMMIT");
      else db.exec(`RELEASE ${sp}`);
      return result;
    } catch (err) {
      if (depth === 0) db.exec("ROLLBACK");
      else db.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw err;
    } finally {
      this.txDepth--;
    }
  }

  // --- events -----------------------------------------------------------------

  async createEvent(input: CreateEventInput): Promise<RawEvent> {
    const [ev] = await this.createEvents([input]);
    return ev!;
  }

  async createEvents(inputs: CreateEventInput[]): Promise<RawEvent[]> {
    if (inputs.length === 0) return [];
    const stmt = this.conn.prepare(
      `INSERT INTO events(id, kind, role, content, agent, session_id, project_id, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const out: RawEvent[] = [];
    await this.transaction(() => {
      for (const input of inputs) {
        const ev: RawEvent = {
          id: input.id ?? newId(),
          kind: input.kind,
          role: input.role,
          content: input.content,
          agent: input.agent,
          sessionId: input.sessionId,
          projectId: input.projectId,
          createdAt: input.createdAt ?? new Date(),
          metadata: input.metadata ?? {},
        };
        stmt.run(
          ev.id,
          ev.kind,
          ev.role ?? null,
          ev.content,
          ev.agent ?? null,
          ev.sessionId ?? null,
          ev.projectId ?? null,
          ev.createdAt.toISOString(),
          JSON.stringify(ev.metadata),
        );
        out.push(ev);
      }
    });
    return out;
  }

  async getEvent(id: string): Promise<RawEvent | null> {
    const row = this.conn.prepare("SELECT * FROM events WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToEvent(row) : null;
  }

  private eventWhere(filter: EventFilter) {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.projectId) {
      where.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.sessionId) {
      where.push("session_id = ?");
      params.push(filter.sessionId);
    }
    if (filter.kind) {
      where.push("kind = ?");
      params.push(filter.kind);
    }
    if (filter.agent) {
      where.push("agent = ?");
      params.push(filter.agent);
    }
    return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
  }

  async listEvents(filter: EventFilter = {}): Promise<RawEvent[]> {
    const { sql, params } = this.eventWhere(filter);
    const rows = this.conn
      .prepare(`SELECT * FROM events ${sql} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 100, filter.offset ?? 0) as Row[];
    return rows.map(rowToEvent);
  }

  async countEvents(filter: EventFilter = {}): Promise<number> {
    const { sql, params } = this.eventWhere(filter);
    const row = this.conn.prepare(`SELECT COUNT(*) AS n FROM events ${sql}`).get(...params) as Row;
    return Number(row.n);
  }

  // --- memories ---------------------------------------------------------------

  async createMemory(record: CreateMemoryRecord): Promise<Memory> {
    const now = new Date();
    const mem: Memory = {
      ...record,
      accessCount: record.accessCount ?? 0,
      createdAt: record.createdAt ?? now,
      updatedAt: record.updatedAt ?? now,
    };
    await this.transaction(() => {
      this.conn
        .prepare(
          `INSERT INTO memories(id, content, type, level, scope, status, project_id, workspace_id, session_id, user_id, agent,
             confidence, importance, access_count, last_accessed_at, created_at, updated_at, expires_at, supersedes, superseded_by,
             tags, content_hash, sensitive, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          mem.id,
          mem.content,
          mem.type,
          mem.level,
          mem.scope,
          mem.status,
          mem.projectId ?? null,
          mem.workspaceId ?? null,
          mem.sessionId ?? null,
          mem.userId ?? null,
          mem.agent ?? null,
          mem.confidence,
          mem.importance,
          mem.accessCount,
          iso(mem.lastAccessedAt),
          mem.createdAt.toISOString(),
          mem.updatedAt.toISOString(),
          iso(mem.expiresAt),
          mem.supersedes ?? null,
          mem.supersededBy ?? null,
          JSON.stringify(mem.tags ?? []),
          mem.contentHash,
          mem.sensitive ? 1 : 0,
          JSON.stringify(mem.metadata ?? {}),
        );
      if (mem.sourceIds.length) this.insertSources(mem.id, mem.sourceIds);
    });
    return (await this.getMemory(mem.id))!;
  }

  private insertSources(memoryId: string, eventIds: string[]) {
    const stmt = this.conn.prepare(
      "INSERT OR IGNORE INTO memory_sources(memory_id, event_id, created_at) VALUES (?, ?, ?)",
    );
    const now = nowIso();
    for (const e of eventIds) {
      const exists = this.conn.prepare("SELECT 1 FROM events WHERE id = ?").get(e);
      if (exists) stmt.run(memoryId, e, now);
    }
  }

  async getMemory(id: string): Promise<Memory | null> {
    const row = this.conn.prepare(`${MEMORY_SELECT} WHERE m.id = ?`).get(id) as Row | undefined;
    return row ? rowToMemory(row) : null;
  }

  async getMemories(ids: string[]): Promise<Memory[]> {
    if (ids.length === 0) return [];
    const out: Memory[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = this.conn
        .prepare(`${MEMORY_SELECT} WHERE m.id IN (${chunk.map(() => "?").join(",")})`)
        .all(...chunk) as Row[];
      out.push(...rows.map(rowToMemory));
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    return out.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }

  async resolveMemoryId(prefix: string): Promise<string[]> {
    const exact = this.conn.prepare("SELECT id FROM memories WHERE id = ?").get(prefix) as
      Row | undefined;
    if (exact) return [String(exact.id)];
    const rows = this.conn
      .prepare("SELECT id FROM memories WHERE id LIKE ? LIMIT 10")
      .all(`${prefix.replace(/[%_]/g, "")}%`) as Row[];
    return rows.map((r) => String(r.id));
  }

  async updateMemory(id: string, patch: MemoryPatch): Promise<Memory> {
    const sets: string[] = [];
    const params: SQLInputValue[] = [];
    const map: Record<string, string> = {
      content: "content",
      type: "type",
      level: "level",
      scope: "scope",
      status: "status",
      projectId: "project_id",
      workspaceId: "workspace_id",
      sessionId: "session_id",
      userId: "user_id",
      agent: "agent",
      confidence: "confidence",
      importance: "importance",
      accessCount: "access_count",
      supersedes: "supersedes",
      supersededBy: "superseded_by",
      contentHash: "content_hash",
    };
    for (const [key, col] of Object.entries(map)) {
      if (key in patch) {
        const v = (patch as Record<string, unknown>)[key];
        sets.push(`${col} = ?`);
        params.push((v ?? null) as SQLInputValue);
      }
    }
    if ("lastAccessedAt" in patch) {
      sets.push("last_accessed_at = ?");
      params.push(iso(patch.lastAccessedAt));
    }
    if ("expiresAt" in patch || patch.clearExpiresAt) {
      sets.push("expires_at = ?");
      params.push(patch.clearExpiresAt ? null : iso(patch.expiresAt));
    }
    if (patch.tags) {
      sets.push("tags = ?");
      params.push(JSON.stringify(patch.tags));
    }
    if (patch.sensitive !== undefined) {
      sets.push("sensitive = ?");
      params.push(patch.sensitive ? 1 : 0);
    }
    if (patch.metadata) {
      sets.push("metadata = ?");
      params.push(JSON.stringify(patch.metadata));
    }
    sets.push("updated_at = ?");
    params.push((patch.updatedAt ?? new Date()).toISOString());
    await this.transaction(() => {
      const res = this.conn
        .prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`)
        .run(...params, id);
      if (Number(res.changes) === 0) throw new NotFoundError("Memory", id);
      if (patch.sourceIds) this.insertSources(id, patch.sourceIds);
    });
    return (await this.getMemory(id))!;
  }

  async deleteMemory(id: string): Promise<void> {
    const res = this.conn.prepare("DELETE FROM memories WHERE id = ?").run(id);
    if (Number(res.changes) === 0) throw new NotFoundError("Memory", id);
  }

  async list(options: ListOptions = {}): Promise<Memory[]> {
    const { sql, params } = compileFilter(options);
    const colMap: Record<string, string> = {
      createdAt: "m.created_at",
      updatedAt: "m.updated_at",
      importance: "m.importance",
      accessCount: "m.access_count",
      lastAccessedAt: "m.last_accessed_at",
    };
    const col = colMap[options.orderBy ?? "createdAt"] ?? "m.created_at";
    const dir = options.order === "asc" ? "ASC" : "DESC";
    const rows = this.conn
      .prepare(`${MEMORY_SELECT} ${sql} ORDER BY ${col} ${dir}, m.rowid ${dir} LIMIT ? OFFSET ?`)
      .all(...params, Math.min(options.limit ?? 50, 10_000), options.offset ?? 0) as Row[];
    return rows.map(rowToMemory);
  }

  async count(filter: MemoryFilter = {}): Promise<number> {
    const { sql, params } = compileFilter(filter);
    const row = this.conn
      .prepare(`SELECT COUNT(*) AS n FROM memories m ${sql}`)
      .get(...params) as Row;
    return Number(row.n);
  }

  async findByHash(hash: string, filter: MemoryFilter = {}): Promise<Memory[]> {
    const { sql, params } = compileFilter(filter);
    const rows = this.conn
      .prepare(`${MEMORY_SELECT} ${sql ? sql + " AND" : "WHERE"} m.content_hash = ? LIMIT 20`)
      .all(...params, hash) as Row[];
    return rows.map(rowToMemory);
  }

  async recordAccess(ids: string[], at: Date = new Date()): Promise<void> {
    if (ids.length === 0) return;
    const stmt = this.conn.prepare(
      "UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?",
    );
    await this.transaction(() => {
      for (const id of ids) stmt.run(at.toISOString(), id);
    });
  }

  async searchKeyword(query: string, filter: MemoryFilter, limit: number): Promise<ScoredId[]> {
    const match = buildFtsQuery(query);
    if (!match) return [];
    const { sql, params } = compileFilter(filter);
    // CROSS JOIN pins the FTS scan as the outer loop; otherwise SQLite may
    // iterate `memories` and re-run the MATCH per row (100k rows -> minutes).
    const rows = this.conn
      .prepare(
        `SELECT m.id AS id, bm25(memories_fts, 1.0, 0.4) AS rank
         FROM memories_fts CROSS JOIN memories m ON m.rowid = memories_fts.rowid
         WHERE memories_fts MATCH ?${sql ? " AND " + sql.replace(/^WHERE /, "") : ""}
         ORDER BY rank LIMIT ?`,
      )
      .all(match, ...params, limit) as Row[];
    return rows.map((r) => ({ id: String(r.id), score: -Number(r.rank) }));
  }

  async searchVector(
    vector: Float32Array,
    model: string,
    filter: MemoryFilter,
    limit: number,
  ): Promise<ScoredId[]> {
    const { sql, params } = compileFilter(filter);
    const stmt = this.conn.prepare(
      `SELECT e.rowid AS rid, e.memory_id AS id, e.vector AS vector
       FROM memory_embeddings e JOIN memories m ON m.id = e.memory_id
       ${sql ? sql + " AND" : "WHERE"} e.model = ? AND e.rowid > ?
       ORDER BY e.rowid LIMIT 1000`,
    );
    const top: ScoredId[] = [];
    let last = -1;
    for (;;) {
      const rows = stmt.all(...params, model, last) as Row[];
      if (rows.length === 0) break;
      for (const r of rows) {
        last = Number(r.rid);
        const buf = r.vector as Uint8Array;
        const vec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
        const score = cosine(vector, vec);
        if (top.length < limit) {
          top.push({ id: String(r.id), score });
          if (top.length === limit) top.sort((a, b) => b.score - a.score);
        } else if (score > top[top.length - 1]!.score) {
          top[top.length - 1] = { id: String(r.id), score };
          top.sort((a, b) => b.score - a.score);
        }
      }
      if (rows.length < 1000) break;
    }
    return top.sort((a, b) => b.score - a.score);
  }

  // --- provenance ---------------------------------------------------------------

  async addSources(memoryId: string, eventIds: string[]): Promise<void> {
    await this.transaction(() => this.insertSources(memoryId, eventIds));
  }

  async getSources(memoryId: string): Promise<RawEvent[]> {
    const rows = this.conn
      .prepare(
        `SELECT e.* FROM events e JOIN memory_sources s ON s.event_id = e.id WHERE s.memory_id = ? ORDER BY e.created_at`,
      )
      .all(memoryId) as Row[];
    return rows.map(rowToEvent);
  }

  async getMemoriesForEvent(eventId: string): Promise<Memory[]> {
    const rows = this.conn
      .prepare(`${MEMORY_SELECT} JOIN memory_sources s ON s.memory_id = m.id WHERE s.event_id = ?`)
      .all(eventId) as Row[];
    return rows.map(rowToMemory);
  }

  // --- embeddings ---------------------------------------------------------------

  async setEmbedding(memoryId: string, model: string, vector: Float32Array): Promise<void> {
    await this.setEmbeddings([{ memoryId, model, vector }]);
  }

  async setEmbeddings(rows: EmbeddingRow[]): Promise<void> {
    if (rows.length === 0) return;
    const stmt = this.conn.prepare(
      `INSERT INTO memory_embeddings(memory_id, model, dims, vector, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(memory_id, model) DO UPDATE SET dims = excluded.dims, vector = excluded.vector, created_at = excluded.created_at`,
    );
    const now = nowIso();
    await this.transaction(() => {
      for (const r of rows) {
        const buf = new Uint8Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength);
        stmt.run(r.memoryId, r.model, r.vector.length, buf, now);
      }
    });
  }

  async getEmbedding(memoryId: string, model: string): Promise<Float32Array | null> {
    const row = this.conn
      .prepare("SELECT vector FROM memory_embeddings WHERE memory_id = ? AND model = ?")
      .get(memoryId, model) as Row | undefined;
    if (!row) return null;
    const buf = row.vector as Uint8Array;
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }

  async listMemoriesWithoutEmbedding(
    model: string,
    limit: number,
    filter: MemoryFilter = {},
  ): Promise<Memory[]> {
    const { sql, params } = compileFilter({ allProjects: true, ...filter });
    const rows = this.conn
      .prepare(
        `${MEMORY_SELECT} ${sql ? sql + " AND" : "WHERE"} m.sensitive = 0 AND NOT EXISTS
           (SELECT 1 FROM memory_embeddings e WHERE e.memory_id = m.id AND e.model = ?)
         ORDER BY m.rowid LIMIT ?`,
      )
      .all(...params, model, limit) as Row[];
    return rows.map(rowToMemory);
  }

  async deleteEmbeddings(model?: string): Promise<number> {
    const res = model
      ? this.conn.prepare("DELETE FROM memory_embeddings WHERE model = ?").run(model)
      : this.conn.prepare("DELETE FROM memory_embeddings").run();
    return Number(res.changes);
  }

  async countEmbeddings(model?: string): Promise<number> {
    const row = (
      model
        ? this.conn
            .prepare("SELECT COUNT(*) AS n FROM memory_embeddings WHERE model = ?")
            .get(model)
        : this.conn.prepare("SELECT COUNT(*) AS n FROM memory_embeddings").get()
    ) as Row;
    return Number(row.n);
  }

  async listEmbeddings(model?: string): Promise<EmbeddingRow[]> {
    const rows = (
      model
        ? this.conn
            .prepare("SELECT memory_id, model, vector FROM memory_embeddings WHERE model = ?")
            .all(model)
        : this.conn.prepare("SELECT memory_id, model, vector FROM memory_embeddings").all()
    ) as Row[];
    return rows.map((r) => {
      const buf = r.vector as Uint8Array;
      return {
        memoryId: String(r.memory_id),
        model: String(r.model),
        vector: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
      };
    });
  }

  // --- scenes --------------------------------------------------------------------

  private sceneMemoryIds(sceneId: string): string[] {
    const rows = this.conn
      .prepare("SELECT memory_id FROM scene_memories WHERE scene_id = ? ORDER BY created_at")
      .all(sceneId) as Row[];
    return rows.map((r) => String(r.memory_id));
  }

  async createScene(input: CreateSceneInput): Promise<SceneMemory> {
    const id = input.id ?? newId();
    const now = nowIso();
    await this.transaction(() => {
      this.conn
        .prepare(
          `INSERT INTO scenes(id, name, summary, project_id, keywords, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.summary ?? "",
          input.projectId ?? null,
          JSON.stringify(input.keywords ?? []),
          now,
          now,
          JSON.stringify(input.metadata ?? {}),
        );
      if (input.memoryIds?.length) this.linkSceneMemories(id, input.memoryIds);
    });
    return (await this.getScene(id))!;
  }

  private linkSceneMemories(sceneId: string, memoryIds: string[]) {
    const stmt = this.conn.prepare(
      "INSERT OR IGNORE INTO scene_memories(scene_id, memory_id, created_at) VALUES (?, ?, ?)",
    );
    const now = nowIso();
    for (const m of memoryIds) stmt.run(sceneId, m, now);
    this.conn.prepare("UPDATE scenes SET updated_at = ? WHERE id = ?").run(now, sceneId);
  }

  async getScene(id: string): Promise<SceneMemory | null> {
    const row = this.conn.prepare("SELECT * FROM scenes WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToScene(row, this.sceneMemoryIds(id)) : null;
  }

  async getSceneByName(name: string, projectId?: string): Promise<SceneMemory | null> {
    const row = this.conn
      .prepare("SELECT * FROM scenes WHERE name = ? AND COALESCE(project_id, '') = ?")
      .get(name, projectId ?? "") as Row | undefined;
    return row ? rowToScene(row, this.sceneMemoryIds(String(row.id))) : null;
  }

  async updateScene(
    id: string,
    patch: Partial<Pick<SceneMemory, "name" | "summary" | "keywords" | "metadata" | "projectId">>,
  ): Promise<SceneMemory> {
    const sets: string[] = [];
    const params: SQLInputValue[] = [];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.summary !== undefined) {
      sets.push("summary = ?");
      params.push(patch.summary);
    }
    if (patch.keywords !== undefined) {
      sets.push("keywords = ?");
      params.push(JSON.stringify(patch.keywords));
    }
    if (patch.metadata !== undefined) {
      sets.push("metadata = ?");
      params.push(JSON.stringify(patch.metadata));
    }
    if ("projectId" in patch) {
      sets.push("project_id = ?");
      params.push(patch.projectId ?? null);
    }
    sets.push("updated_at = ?");
    params.push(nowIso());
    const res = this.conn
      .prepare(`UPDATE scenes SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params, id);
    if (Number(res.changes) === 0) throw new NotFoundError("Scene", id);
    return (await this.getScene(id))!;
  }

  async deleteScene(id: string): Promise<void> {
    const res = this.conn.prepare("DELETE FROM scenes WHERE id = ?").run(id);
    if (Number(res.changes) === 0) throw new NotFoundError("Scene", id);
  }

  async listScenes(
    filter: { projectId?: string; allProjects?: boolean; limit?: number; offset?: number } = {},
  ): Promise<SceneMemory[]> {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (!filter.allProjects) {
      if (filter.projectId) {
        where.push("(project_id = ? OR project_id IS NULL)");
        params.push(filter.projectId);
      } else {
        where.push("project_id IS NULL");
      }
    }
    const rows = this.conn
      .prepare(
        `SELECT * FROM scenes ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.limit ?? 100, filter.offset ?? 0) as Row[];
    return rows.map((r) => rowToScene(r, this.sceneMemoryIds(String(r.id))));
  }

  async addSceneMemories(sceneId: string, memoryIds: string[]): Promise<void> {
    await this.transaction(() => this.linkSceneMemories(sceneId, memoryIds));
  }

  async removeSceneMemory(sceneId: string, memoryId: string): Promise<void> {
    this.conn
      .prepare("DELETE FROM scene_memories WHERE scene_id = ? AND memory_id = ?")
      .run(sceneId, memoryId);
  }

  async getScenesForMemory(memoryId: string): Promise<SceneMemory[]> {
    const rows = this.conn
      .prepare(
        "SELECT s.* FROM scenes s JOIN scene_memories sm ON sm.scene_id = s.id WHERE sm.memory_id = ?",
      )
      .all(memoryId) as Row[];
    return rows.map((r) => rowToScene(r, this.sceneMemoryIds(String(r.id))));
  }

  // --- projects / sessions -------------------------------------------------------

  async upsertProject(input: {
    name: string;
    id?: string;
    description?: string;
    rootPath?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Project> {
    const existing = await this.getProject(input.name);
    const now = nowIso();
    if (existing) {
      this.conn
        .prepare(
          "UPDATE projects SET description = COALESCE(?, description), root_path = COALESCE(?, root_path), metadata = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          input.description ?? null,
          input.rootPath ?? null,
          JSON.stringify({ ...existing.metadata, ...(input.metadata ?? {}) }),
          now,
          existing.id,
        );
      return (await this.getProject(existing.id))!;
    }
    const id = input.id ?? input.name;
    this.conn
      .prepare(
        "INSERT INTO projects(id, name, description, root_path, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.name,
        input.description ?? null,
        input.rootPath ?? null,
        now,
        now,
        JSON.stringify(input.metadata ?? {}),
      );
    return (await this.getProject(id))!;
  }

  async getProject(idOrName: string): Promise<Project | null> {
    const row = this.conn
      .prepare("SELECT * FROM projects WHERE id = ? OR name = ?")
      .get(idOrName, idOrName) as Row | undefined;
    return row ? rowToProject(row) : null;
  }

  async listProjects(): Promise<Project[]> {
    return (this.conn.prepare("SELECT * FROM projects ORDER BY name").all() as Row[]).map(
      rowToProject,
    );
  }

  async deleteProject(idOrName: string): Promise<void> {
    const p = await this.getProject(idOrName);
    if (!p) throw new NotFoundError("Project", idOrName);
    this.conn.prepare("DELETE FROM projects WHERE id = ?").run(p.id);
  }

  async upsertSession(input: {
    id: string;
    projectId?: string;
    agent?: string;
    startedAt?: Date;
    endedAt?: Date;
    metadata?: Record<string, unknown>;
  }): Promise<Session> {
    const existing = await this.getSession(input.id);
    if (existing) {
      this.conn
        .prepare(
          "UPDATE sessions SET project_id = COALESCE(?, project_id), agent = COALESCE(?, agent), ended_at = COALESCE(?, ended_at), metadata = ? WHERE id = ?",
        )
        .run(
          input.projectId ?? null,
          input.agent ?? null,
          iso(input.endedAt),
          JSON.stringify({ ...existing.metadata, ...(input.metadata ?? {}) }),
          input.id,
        );
    } else {
      this.conn
        .prepare(
          "INSERT INTO sessions(id, project_id, agent, started_at, ended_at, metadata) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.projectId ?? null,
          input.agent ?? null,
          (input.startedAt ?? new Date()).toISOString(),
          iso(input.endedAt),
          JSON.stringify(input.metadata ?? {}),
        );
    }
    return (await this.getSession(input.id))!;
  }

  async getSession(id: string): Promise<Session | null> {
    const row = this.conn.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToSession(row) : null;
  }

  async listSessions(filter: { projectId?: string; limit?: number } = {}): Promise<Session[]> {
    const rows = (
      filter.projectId
        ? this.conn
            .prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT ?")
            .all(filter.projectId, filter.limit ?? 100)
        : this.conn
            .prepare("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?")
            .all(filter.limit ?? 100)
    ) as Row[];
    return rows.map(rowToSession);
  }

  // --- maintenance ------------------------------------------------------------------

  async stats(): Promise<MemoryStats> {
    const db = this.conn;
    const group = (col: string) =>
      Object.fromEntries(
        (
          db
            .prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM memories GROUP BY ${col}`)
            .all() as Row[]
        ).map((r) => [String(r.k), Number(r.n)]),
      );
    const one = (sql: string) => Number((db.prepare(sql).get() as Row).n);
    let dbSizeBytes: number | undefined;
    if (this.location !== ":memory:" && existsSync(this.location))
      dbSizeBytes = statSync(this.location).size;
    return {
      memories: one("SELECT COUNT(*) AS n FROM memories"),
      byLevel: group("level"),
      byStatus: group("status"),
      byScope: group("scope"),
      byType: group("type"),
      events: one("SELECT COUNT(*) AS n FROM events"),
      scenes: one("SELECT COUNT(*) AS n FROM scenes"),
      projects: one("SELECT COUNT(*) AS n FROM projects"),
      embeddings: one("SELECT COUNT(*) AS n FROM memory_embeddings"),
      dbPath: this.location,
      dbSizeBytes,
    };
  }

  async exportAll(options: { includeEmbeddings?: boolean } = {}): Promise<ExportData> {
    const db = this.conn;
    const memories: Memory[] = [];
    const events: RawEvent[] = [];
    const chunk = 2000;
    for (let offset = 0; ; offset += chunk) {
      const rows = db
        .prepare(`${MEMORY_SELECT} ORDER BY m.rowid LIMIT ? OFFSET ?`)
        .all(chunk, offset) as Row[];
      memories.push(...rows.map(rowToMemory));
      if (rows.length < chunk) break;
    }
    for (let offset = 0; ; offset += chunk) {
      const rows = db
        .prepare("SELECT * FROM events ORDER BY rowid LIMIT ? OFFSET ?")
        .all(chunk, offset) as Row[];
      events.push(...rows.map(rowToEvent));
      if (rows.length < chunk) break;
    }
    const scenes = (db.prepare("SELECT * FROM scenes ORDER BY rowid").all() as Row[]).map((r) =>
      rowToScene(r, this.sceneMemoryIds(String(r.id))),
    );
    const data: ExportData = {
      version: 1,
      exportedAt: nowIso(),
      projects: await this.listProjects(),
      sessions: await this.listSessions({ limit: 100_000 }),
      events,
      memories,
      scenes,
    };
    if (options.includeEmbeddings) {
      data.embeddings = (await this.listEmbeddings()).map((e) => ({
        memoryId: e.memoryId,
        model: e.model,
        vector: Array.from(e.vector),
      }));
    }
    return data;
  }

  async vacuum(): Promise<void> {
    this.conn.exec("VACUUM");
  }
}
