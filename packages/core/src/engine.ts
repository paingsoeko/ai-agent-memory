import type { AIMemoryConfig } from "./config.js";
import type { EmbeddingProvider } from "./embeddings/provider.js";
import { InvalidInputError, MemoryError, NotFoundError } from "./errors.js";
import { createHeuristicExtractor } from "./ingest/extractor.js";
import { looksLikeSecret } from "./ingest/secrets.js";
import { detectDuplicateOrConflict } from "./lifecycle/dedup.js";
import { evaluatePromotion } from "./lifecycle/promotion.js";
import { assignScene, refreshScene } from "./lifecycle/scenes.js";
import { rankCandidates } from "./search/rank.js";
import { reciprocalRankFusion } from "./search/rrf.js";
import type {
  CreateEventInput,
  CreateSceneInput,
  EventFilter,
  MemoryStore,
  ScoredId,
} from "./storage/store.js";
import type {
  ConsolidateResult,
  ExportData,
  ForgetOptions,
  ImportOptions,
  ImportResult,
  IngestInput,
  IngestResult,
  ListOptions,
  Memory,
  MemoryExtractor,
  MemoryFilter,
  MemoryHistoryEntry,
  MemoryInspection,
  MemoryResult,
  MemoryScope,
  MemoryStats,
  Project,
  RawEvent,
  RecallOptions,
  RememberInput,
  RememberResult,
  SceneMemory,
  SearchOptions,
  UpdateMemoryInput,
} from "./types.js";
import { MEMORY_SCOPES } from "./types.js";
import { clamp01, newId, toDate } from "./util/ids.js";
import { contentHash } from "./util/text.js";

export interface PrivacyInfo {
  storage: "local";
  storagePath: string;
  telemetry: "disabled";
  analytics: "disabled";
  cloudSync: "disabled";
  embeddings: string;
  embeddingsNetwork: "disabled" | "required";
  network: "disabled" | "embeddings-only";
  encryption: "none (SQLite file; see docs/security-privacy.md)";
}

export interface MemoryEngineOptions {
  store: MemoryStore;
  config: AIMemoryConfig;
  embeddingProvider?: EmbeddingProvider | null;
  extractor?: MemoryExtractor;
}

function historyEntry(
  action: MemoryHistoryEntry["action"],
  detail?: string,
  relatedId?: string,
): MemoryHistoryEntry {
  return {
    at: new Date().toISOString(),
    action,
    ...(detail ? { detail } : {}),
    ...(relatedId ? { relatedId } : {}),
  };
}

function withHistory(
  metadata: Record<string, unknown>,
  entry: MemoryHistoryEntry,
): Record<string, unknown> {
  const history = Array.isArray(metadata.history) ? (metadata.history as MemoryHistoryEntry[]) : [];
  return { ...metadata, history: [...history, entry].slice(-50) };
}

/**
 * The memory engine: the only object users interact with. It composes a
 * MemoryStore, an optional EmbeddingProvider and the lifecycle rules.
 */
export class MemoryEngine {
  readonly store: MemoryStore;
  readonly config: AIMemoryConfig;
  readonly embeddings: EmbeddingProvider | null;
  private readonly extractor: MemoryExtractor;

  constructor(options: MemoryEngineOptions) {
    this.store = options.store;
    this.config = options.config;
    this.embeddings = options.embeddingProvider ?? null;
    this.extractor = options.extractor ?? createHeuristicExtractor();
  }

  /** Active project (from config / options), if any. */
  get project(): string | undefined {
    return this.config.project;
  }

  async close(): Promise<void> {
    await this.store.close();
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private resolveProject(
    input: { projectId?: string; project?: string } | undefined,
    explicitGlobal = false,
  ): string | undefined {
    if (explicitGlobal) return undefined;
    return input?.projectId ?? input?.project ?? this.config.project;
  }

  private scopeFilter(filter: MemoryFilter): MemoryFilter {
    const projectId = filter.allProjects ? filter.projectId : this.resolveProject(filter);
    return { ...filter, projectId };
  }

  private async ensureProject(projectId: string | undefined): Promise<void> {
    if (!projectId) return;
    if (!(await this.store.getProject(projectId)))
      await this.store.upsertProject({ name: projectId });
  }

  private semanticEnabled(mode?: SearchOptions["mode"]): boolean {
    if (!this.embeddings) return false;
    if (mode === "keyword") return false;
    if (mode === "semantic" || mode === "hybrid") return true;
    return this.config.search.semantic;
  }

  private async embedText(text: string): Promise<Float32Array | null> {
    if (!this.embeddings) return null;
    const v = await this.embeddings.embed(text);
    return Float32Array.from(v);
  }

  private canEmbed(memory: Pick<Memory, "sensitive">): boolean {
    if (!this.embeddings) return false;
    if (memory.sensitive && this.embeddings.requiresNetwork) return false;
    return true;
  }

  private async embedMemory(memory: Memory, vector?: Float32Array | null): Promise<void> {
    if (!this.canEmbed(memory) || !this.embeddings) return;
    const v = vector ?? (await this.embedText(memory.content));
    if (v) await this.store.setEmbedding(memory.id, this.embeddings.model, v);
  }

  /** Resolve a full or abbreviated memory id. */
  async resolveId(idOrPrefix: string): Promise<string> {
    const matches = await this.store.resolveMemoryId(idOrPrefix);
    if (matches.length === 1) return matches[0]!;
    if (matches.length === 0) throw new NotFoundError("Memory", idOrPrefix);
    throw new MemoryError(
      "AMBIGUOUS",
      `Id prefix "${idOrPrefix}" matches ${matches.length} memories`,
      "Provide more characters of the id.",
    );
  }

  // ---------------------------------------------------------------------------
  // remember
  // ---------------------------------------------------------------------------

  async remember(input: RememberInput): Promise<RememberResult> {
    const content = (input.content ?? "").replace(/\s+/g, " ").trim();
    if (!content) throw new InvalidInputError("Memory content must not be empty.");
    if (content.length > 10_000)
      throw new InvalidInputError(
        "Memory content is too long (max 10,000 characters).",
        "Store a summary, keep the full text as a raw event.",
      );

    const projectId = this.resolveProject(
      input,
      input.scope === "global" || input.scope === "user",
    );
    let scope: MemoryScope = input.scope ?? this.config.memory.defaultScope;
    if (!MEMORY_SCOPES.includes(scope))
      throw new InvalidInputError(
        `Invalid scope "${scope}"`,
        `Use one of: ${MEMORY_SCOPES.join(", ")}`,
      );
    if (!projectId && (scope === "project" || scope === "workspace")) scope = "user";
    await this.ensureProject(projectId);

    let expiresAt = toDate(input.expiresAt);
    if (!expiresAt && input.ttlMs) expiresAt = new Date(Date.now() + input.ttlMs);
    if (!expiresAt && scope === "session" && this.config.memory.sessionTtlMs > 0) {
      expiresAt = new Date(Date.now() + this.config.memory.sessionTtlMs);
    }
    const sensitive = input.sensitive ?? looksLikeSecret(content);
    const confidence = clamp01(input.confidence, 0.8);
    const importance = clamp01(input.importance, defaultImportance(input.type ?? "fact"));
    const tags = [...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))];
    const filter: MemoryFilter = { projectId, allProjects: false };

    let vector: Float32Array | null = null;
    if (this.embeddings && !(sensitive && this.embeddings.requiresNetwork))
      vector = await this.embedText(content);

    if (!input.force && this.config.memory.dedup.enabled) {
      const decision = await detectDuplicateOrConflict(this.store, content, filter, {
        threshold: this.config.memory.dedup.threshold,
        semanticThreshold: this.config.memory.dedup.semanticThreshold,
        vector: vector ?? undefined,
        model: this.embeddings?.model,
      });
      if (decision.kind === "duplicate" && decision.memory) {
        const merged = await this.mergeInto(
          decision.memory,
          {
            content,
            confidence,
            importance,
            tags,
            sourceIds: input.sourceIds ?? [],
            metadata: input.metadata,
          },
          decision.reason,
        );
        await this.maybePromote(merged.id);
        if (input.scene) await this.attachScene(merged, input.scene);
        return {
          memory: (await this.store.getMemory(merged.id))!,
          action: "merged",
          relatedId: decision.memory.id,
          similarity: decision.similarity,
        };
      }
      if (
        decision.kind === "conflict" &&
        decision.memory &&
        this.config.memory.conflicts.policy !== "ignore"
      ) {
        const created = await this.insertMemory({
          content,
          type: input.type ?? decision.memory.type,
          scope,
          projectId,
          input,
          confidence,
          importance,
          tags,
          expiresAt,
          sensitive,
          vector,
        });
        const action = await this.applyConflict(decision.memory, created);
        if (input.scene) await this.attachScene(created, input.scene);
        return {
          memory: (await this.store.getMemory(created.id))!,
          action,
          relatedId: decision.memory.id,
          similarity: decision.similarity,
        };
      }
    }

    const created = await this.insertMemory({
      content,
      type: input.type ?? "fact",
      scope,
      projectId,
      input,
      confidence,
      importance,
      tags,
      expiresAt,
      sensitive,
      vector,
    });
    if (input.scene) await this.attachScene(created, input.scene);
    else if (this.config.memory.autoScenes)
      await assignScene(this.store, created).catch(() => null);
    await this.maybePromote(created.id);
    return { memory: (await this.store.getMemory(created.id))!, action: "created" };
  }

  private async insertMemory(p: {
    content: string;
    type: string;
    scope: MemoryScope;
    projectId?: string;
    input: RememberInput;
    confidence: number;
    importance: number;
    tags: string[];
    expiresAt?: Date;
    sensitive: boolean;
    vector: Float32Array | null;
  }): Promise<Memory> {
    const { input } = p;
    const created = await this.store.createMemory({
      id: newId(),
      content: p.content,
      type: p.type,
      level: "atomic",
      scope: p.scope,
      status: "active",
      projectId: p.projectId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      userId: input.userId,
      agent: input.agent,
      confidence: p.confidence,
      importance: p.importance,
      expiresAt: p.expiresAt,
      sourceIds: input.sourceIds ?? [],
      tags: p.tags,
      contentHash: contentHash(p.content),
      sensitive: p.sensitive,
      metadata: withHistory(
        { ...(input.metadata ?? {}), mergeCount: 0 },
        historyEntry("created", input.agent ? `by ${input.agent}` : undefined),
      ),
    });
    if (this.config.embeddings.eager) await this.embedMemory(created, p.vector);
    return created;
  }

  private async mergeInto(
    existing: Memory,
    incoming: {
      content: string;
      confidence: number;
      importance: number;
      tags: string[];
      sourceIds: string[];
      metadata?: Record<string, unknown>;
    },
    reason?: string,
  ): Promise<Memory> {
    const aliases = new Set<string>(
      Array.isArray(existing.metadata.aliases) ? (existing.metadata.aliases as string[]) : [],
    );
    if (incoming.content !== existing.content) aliases.add(incoming.content);
    const mergeCount = Number(existing.metadata.mergeCount ?? 0) + 1;
    const metadata = withHistory(
      {
        ...existing.metadata,
        ...(incoming.metadata ?? {}),
        mergeCount,
        aliases: [...aliases].slice(-10),
      },
      historyEntry("merged", reason),
    );
    return this.store.updateMemory(existing.id, {
      confidence: Math.min(1, Math.max(existing.confidence, incoming.confidence) + 0.05),
      importance: Math.max(existing.importance, incoming.importance),
      tags: [...new Set([...existing.tags, ...incoming.tags])],
      sourceIds: incoming.sourceIds,
      metadata,
    });
  }

  private async applyConflict(old: Memory, fresh: Memory): Promise<"superseded" | "conflicted"> {
    const policy = this.config.memory.conflicts.policy;
    if (policy === "supersede") {
      await this.supersede(old.id, fresh.id);
      return "superseded";
    }
    await this.store.updateMemory(old.id, {
      status: "conflicted",
      metadata: withHistory(
        {
          ...old.metadata,
          conflictsWith: [
            ...new Set([...((old.metadata.conflictsWith as string[] | undefined) ?? []), fresh.id]),
          ],
        },
        historyEntry("conflicted", undefined, fresh.id),
      ),
    });
    await this.store.updateMemory(fresh.id, {
      status: "conflicted",
      metadata: withHistory(
        { ...fresh.metadata, conflictsWith: [old.id] },
        historyEntry("conflicted", undefined, old.id),
      ),
    });
    return "conflicted";
  }

  /** Mark `oldId` as superseded by `newId` (the old memory is preserved). */
  async supersede(oldId: string, newId: string): Promise<{ old: Memory; fresh: Memory }> {
    const old = await this.get(oldId);
    const fresh = await this.get(newId);
    await this.store.transaction(async () => {
      await this.store.updateMemory(old.id, {
        status: "superseded",
        supersededBy: fresh.id,
        level: old.level === "core" ? "atomic" : old.level,
        metadata: withHistory(old.metadata, historyEntry("superseded", undefined, fresh.id)),
      });
      await this.store.updateMemory(fresh.id, {
        status: fresh.status === "conflicted" ? "active" : fresh.status,
        supersedes: old.id,
        metadata: withHistory(
          fresh.metadata,
          historyEntry("updated", "supersedes older memory", old.id),
        ),
      });
    });
    return {
      old: (await this.store.getMemory(old.id))!,
      fresh: (await this.store.getMemory(fresh.id))!,
    };
  }

  /** Resolve a flagged conflict by choosing the winner; the loser is superseded. */
  async resolveConflict(
    winnerId: string,
    loserId: string,
  ): Promise<{ old: Memory; fresh: Memory }> {
    return this.supersede(loserId, winnerId);
  }

  private async attachScene(memory: Memory, sceneName: string): Promise<SceneMemory> {
    let scene = await this.store.getSceneByName(sceneName, memory.projectId);
    if (!scene)
      scene = await this.store.createScene({
        name: sceneName,
        projectId: memory.projectId,
        memoryIds: [memory.id],
      });
    else await this.store.addSceneMemories(scene.id, [memory.id]);
    return refreshScene(this.store, scene.id);
  }

  private async maybePromote(id: string): Promise<boolean> {
    if (!this.config.memory.autoPromotion) return false;
    const mem = await this.store.getMemory(id);
    if (!mem) return false;
    const ev = evaluatePromotion(mem, this.config.memory.promotion);
    if (!ev.eligible) return false;
    await this.promote(id, `auto: evidence ${ev.evidence}`);
    return true;
  }

  /** Promote a memory to core (L3). */
  async promote(id: string, reason = "manual"): Promise<Memory> {
    const mem = await this.get(id);
    if (mem.level === "core") return mem;
    return this.store.updateMemory(mem.id, {
      level: "core",
      metadata: withHistory(mem.metadata, historyEntry("promoted", reason)),
    });
  }

  async demote(id: string, reason = "manual"): Promise<Memory> {
    const mem = await this.get(id);
    if (mem.level === "atomic") return mem;
    return this.store.updateMemory(mem.id, {
      level: "atomic",
      metadata: withHistory(mem.metadata, historyEntry("demoted", reason)),
    });
  }

  // ---------------------------------------------------------------------------
  // read
  // ---------------------------------------------------------------------------

  async get(idOrPrefix: string): Promise<Memory> {
    const id = await this.resolveId(idOrPrefix);
    const mem = await this.store.getMemory(id);
    if (!mem) throw new NotFoundError("Memory", idOrPrefix);
    return mem;
  }

  async list(options: ListOptions = {}): Promise<Memory[]> {
    return this.store.list(this.scopeFilter(options) as ListOptions);
  }

  async count(filter: MemoryFilter = {}): Promise<number> {
    return this.store.count(this.scopeFilter(filter));
  }

  async inspect(idOrPrefix: string): Promise<MemoryInspection> {
    const memory = await this.get(idOrPrefix);
    const [sources, scenes] = await Promise.all([
      this.store.getSources(memory.id),
      this.store.getScenesForMemory(memory.id),
    ]);
    const supersedes = memory.supersedes ? await this.store.getMemory(memory.supersedes) : null;
    const supersededBy = memory.supersededBy
      ? await this.store.getMemory(memory.supersededBy)
      : null;
    const relatedIds = new Set<string>();
    for (const s of scenes) for (const id of s.memoryIds) if (id !== memory.id) relatedIds.add(id);
    if (relatedIds.size < 5) {
      const hits = await this.store.searchKeyword(
        memory.content,
        { projectId: memory.projectId, allProjects: !memory.projectId },
        8,
      );
      for (const h of hits) if (h.id !== memory.id) relatedIds.add(h.id);
    }
    const related = (await this.store.getMemories([...relatedIds].slice(0, 8))).filter(
      (m) => m.id !== memory.id,
    );
    const history = Array.isArray(memory.metadata.history)
      ? (memory.metadata.history as MemoryHistoryEntry[])
      : [];
    return { memory, sources, scenes, supersedes, supersededBy, related, history };
  }

  // ---------------------------------------------------------------------------
  // search / recall
  // ---------------------------------------------------------------------------

  private async retrieve(
    options: SearchOptions,
  ): Promise<{ fused: ReturnType<typeof reciprocalRankFusion>; memories: Map<string, Memory> }> {
    const query = (options.query ?? "").trim();
    if (!query) throw new InvalidInputError("Search query must not be empty.");
    const filter = this.scopeFilter(options);
    const limit = Math.max(
      options.candidateLimit ?? this.config.search.candidateLimit,
      (options.limit ?? 10) + (options.offset ?? 0),
    );
    const lists: { name: "keyword" | "semantic"; results: ScoredId[] }[] = [];
    const useKeyword = options.mode !== "semantic" && this.config.search.keyword;
    const useSemantic = this.semanticEnabled(options.mode);
    if (useKeyword)
      lists.push({
        name: "keyword",
        results: await this.store.searchKeyword(query, filter, limit),
      });
    if (useSemantic && this.embeddings) {
      const v = await this.embedText(query);
      if (v)
        lists.push({
          name: "semantic",
          results: await this.store.searchVector(v, this.embeddings.model, filter, limit),
        });
    }
    if (lists.length === 0) {
      throw new MemoryError(
        "UNSUPPORTED",
        options.mode === "semantic"
          ? "Semantic search requires an embedding provider."
          : "No search backend enabled.",
        'Configure embeddings.provider (e.g. "hash") or enable search.keyword.',
      );
    }
    const fused = reciprocalRankFusion(lists, this.config.search.rrfK);
    const memories = new Map(
      (await this.store.getMemories(fused.map((f) => f.id))).map((m) => [m.id, m]),
    );
    return { fused, memories };
  }

  /** Pure relevance search (RRF over keyword + semantic). No access tracking. */
  async search(options: SearchOptions): Promise<MemoryResult[]> {
    const { fused, memories } = await this.retrieve(options);
    const ranked = rankCandidates(fused, memories, {
      projectId: this.resolveProject(options),
      weights: this.config.search.weights,
      recencyHalfLifeDays: this.config.search.recencyHalfLifeDays,
      applyBoosts: false,
    });
    return ranked.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 10));
  }

  /** Agent-facing recall: relevance + importance/confidence/recency/project boosts, records access. */
  async recall(options: RecallOptions): Promise<MemoryResult[]> {
    const { fused, memories } = await this.retrieve(options);
    const projectId = this.resolveProject(options);
    let ranked = rankCandidates(fused, memories, {
      projectId,
      weights: this.config.search.weights,
      recencyHalfLifeDays: this.config.search.recencyHalfLifeDays,
      applyBoosts: true,
    });
    if (options.includeCore) {
      const core = await this.store.list({
        ...this.scopeFilter(options),
        level: "core",
        limit: 5,
        orderBy: "importance",
      });
      const seen = new Set(ranked.map((r) => r.memory.id));
      for (const m of core) {
        if (seen.has(m.id)) continue;
        ranked.push({
          memory: m,
          score: Number((0.3 * m.importance).toFixed(6)),
          source: "keyword",
          explanation: "core memory (always included)",
        });
      }
      ranked = ranked.sort((a, b) => b.score - a.score);
    }
    const page = ranked.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 10));
    if (options.trackAccess !== false && page.length) {
      await this.store.recordAccess(page.map((r) => r.memory.id));
      for (const r of page) {
        r.memory.accessCount += 1;
        r.memory.lastAccessedAt = new Date();
      }
    }
    return page;
  }

  // ---------------------------------------------------------------------------
  // update / forget
  // ---------------------------------------------------------------------------

  async update(idOrPrefix: string, patch: UpdateMemoryInput): Promise<Memory> {
    const mem = await this.get(idOrPrefix);
    const changes: Parameters<MemoryStore["updateMemory"]>[1] = {};
    const details: string[] = [];
    if (patch.content !== undefined) {
      const content = patch.content.replace(/\s+/g, " ").trim();
      if (!content) throw new InvalidInputError("Memory content must not be empty.");
      changes.content = content;
      changes.contentHash = contentHash(content);
      details.push("content");
    }
    if (patch.type !== undefined) {
      changes.type = patch.type;
      details.push("type");
    }
    if (patch.scope !== undefined) {
      if (!MEMORY_SCOPES.includes(patch.scope))
        throw new InvalidInputError(`Invalid scope "${patch.scope}"`);
      changes.scope = patch.scope;
      details.push("scope");
    }
    if (patch.projectId !== undefined) {
      changes.projectId = patch.projectId ?? undefined;
      await this.ensureProject(patch.projectId ?? undefined);
      details.push("project");
    }
    if (patch.confidence !== undefined) {
      changes.confidence = clamp01(patch.confidence, mem.confidence);
      details.push("confidence");
    }
    if (patch.importance !== undefined) {
      changes.importance = clamp01(patch.importance, mem.importance);
      details.push("importance");
    }
    if (patch.tags !== undefined) {
      changes.tags = [...new Set(patch.tags)];
      details.push("tags");
    }
    if (patch.status !== undefined) {
      changes.status = patch.status;
      details.push("status");
    }
    if (patch.level !== undefined) {
      changes.level = patch.level;
      details.push("level");
    }
    if (patch.sensitive !== undefined) {
      changes.sensitive = patch.sensitive;
      details.push("sensitive");
    }
    if (patch.expiresAt !== undefined) {
      if (patch.expiresAt === null) changes.clearExpiresAt = true;
      else changes.expiresAt = toDate(patch.expiresAt);
      details.push("expiresAt");
    }
    changes.metadata = withHistory(
      { ...mem.metadata, ...(patch.metadata ?? {}) },
      historyEntry("updated", details.join(", ")),
    );
    const updated = await this.store.updateMemory(mem.id, changes);
    if (patch.content !== undefined && this.config.embeddings.eager)
      await this.embedMemory(updated);
    return updated;
  }

  async forget(
    idOrPrefix: string,
    options: ForgetOptions = {},
  ): Promise<{ id: string; archived: boolean }> {
    const mem = await this.get(idOrPrefix);
    if (options.archive) {
      await this.store.updateMemory(mem.id, {
        status: "archived",
        metadata: withHistory(mem.metadata, historyEntry("archived")),
      });
      return { id: mem.id, archived: true };
    }
    await this.store.deleteMemory(mem.id);
    return { id: mem.id, archived: false };
  }

  // ---------------------------------------------------------------------------
  // events / ingestion
  // ---------------------------------------------------------------------------

  async addEvent(input: CreateEventInput): Promise<RawEvent> {
    const projectId = input.projectId ?? this.config.project;
    await this.ensureProject(projectId);
    return this.store.createEvent({ ...input, projectId });
  }

  async listEvents(filter: EventFilter = {}): Promise<RawEvent[]> {
    return this.store.listEvents({ projectId: this.config.project, ...filter });
  }

  async getEvent(id: string): Promise<RawEvent | null> {
    return this.store.getEvent(id);
  }

  /**
   * Automatic memory mode: store raw events (L0), extract durable candidates,
   * then run each through the normal remember() lifecycle (dedup, conflicts,
   * scenes, promotion) with provenance links back to the events.
   */
  async ingest(input: IngestInput): Promise<IngestResult> {
    const projectId = this.resolveProject(input);
    await this.ensureProject(projectId);
    const sessionId = input.sessionId ?? newId();
    await this.store.upsertSession({ id: sessionId, projectId, agent: input.agent });

    let events: RawEvent[] = [];
    if (!input.skipEvents) {
      events = await this.store.createEvents(
        input.messages.map((m) => ({
          kind: m.kind ?? "message",
          role: m.role,
          content: m.content,
          agent: input.agent,
          sessionId,
          projectId,
          createdAt: toDate(m.createdAt),
          metadata: m.metadata ?? {},
        })),
      );
    }
    if (input.rawOnly) return { events, candidates: [], results: [], skipped: 0 };

    const extractor = input.extractor ?? this.extractor;
    const candidates = await extractor(input.messages, {
      projectId,
      sessionId,
      agent: input.agent,
    });
    const minConfidence = input.minConfidence ?? this.config.memory.ingest.minConfidence;
    const results: RememberResult[] = [];
    let skipped = 0;
    const max = this.config.memory.ingest.maxPerBatch;
    for (const c of candidates) {
      if (results.length >= max) {
        skipped++;
        continue;
      }
      if (c.confidence < minConfidence || looksLikeSecret(c.content)) {
        skipped++;
        continue;
      }
      const sourceEvent = events[c.messageIndex];
      results.push(
        await this.remember({
          content: c.content,
          type: c.type,
          scope: c.scope,
          projectId,
          workspaceId: input.workspaceId,
          sessionId,
          agent: input.agent,
          confidence: c.confidence,
          importance: c.importance,
          tags: c.tags,
          sourceIds: sourceEvent ? [sourceEvent.id] : [],
          metadata: { extractedBy: input.extractor ? "custom" : "heuristic", reason: c.reason },
        }),
      );
    }
    return { events, candidates, results, skipped };
  }

  // ---------------------------------------------------------------------------
  // scenes / projects
  // ---------------------------------------------------------------------------

  async listScenes(
    filter: { projectId?: string; allProjects?: boolean; limit?: number; offset?: number } = {},
  ): Promise<SceneMemory[]> {
    return this.store.listScenes({
      ...filter,
      projectId: filter.allProjects ? filter.projectId : this.resolveProject(filter),
    });
  }

  async getScene(id: string): Promise<SceneMemory> {
    const s = await this.store.getScene(id);
    if (!s) throw new NotFoundError("Scene", id);
    return s;
  }

  async createScene(input: CreateSceneInput & { project?: string }): Promise<SceneMemory> {
    return this.store.createScene({ ...input, projectId: this.resolveProject(input) });
  }

  async updateScene(
    id: string,
    patch: { name?: string; summary?: string; keywords?: string[] },
  ): Promise<SceneMemory> {
    const scene = await this.getScene(id);
    return this.store.updateScene(id, {
      ...patch,
      metadata: {
        ...scene.metadata,
        ...(patch.summary !== undefined ? { customSummary: true } : {}),
      },
    });
  }

  async addToScene(sceneId: string, memoryIds: string[]): Promise<SceneMemory> {
    await this.getScene(sceneId);
    await this.store.addSceneMemories(
      sceneId,
      await Promise.all(memoryIds.map((m) => this.resolveId(m))),
    );
    return refreshScene(this.store, sceneId);
  }

  async removeFromScene(sceneId: string, memoryId: string): Promise<void> {
    await this.store.removeSceneMemory(sceneId, await this.resolveId(memoryId));
  }

  async deleteScene(id: string): Promise<void> {
    await this.store.deleteScene(id);
  }

  async createProject(
    name: string,
    extra: { description?: string; rootPath?: string } = {},
  ): Promise<Project> {
    if (!name.trim()) throw new InvalidInputError("Project name must not be empty.");
    return this.store.upsertProject({ name: name.trim(), ...extra });
  }

  async listProjects(): Promise<Project[]> {
    return this.store.listProjects();
  }

  async getProject(name: string): Promise<Project | null> {
    return this.store.getProject(name);
  }

  // ---------------------------------------------------------------------------
  // maintenance
  // ---------------------------------------------------------------------------

  /** Embed memories that have no embedding for the current model, in batches. */
  async embedPending(limit = 500): Promise<number> {
    if (!this.embeddings) return 0;
    const batchSize = Math.max(1, this.config.embeddings.batchSize);
    let done = 0;
    while (done < limit) {
      const batch = await this.store.listMemoriesWithoutEmbedding(
        this.embeddings.model,
        Math.min(batchSize, limit - done),
      );
      const eligible = batch.filter((m) => this.canEmbed(m));
      if (eligible.length === 0) break;
      const vectors = await this.embeddings.embedBatch(eligible.map((m) => m.content));
      await this.store.setEmbeddings(
        eligible.map((m, i) => ({
          memoryId: m.id,
          model: this.embeddings!.model,
          vector: Float32Array.from(vectors[i]!),
        })),
      );
      done += eligible.length;
      if (batch.length < batchSize) break;
    }
    return done;
  }

  /** Run the full lifecycle pass: expiry, promotion/demotion, scene clustering, embeddings. */
  async consolidate(
    options: { projectId?: string; allProjects?: boolean } = {},
  ): Promise<ConsolidateResult> {
    const result: ConsolidateResult = {
      promoted: [],
      demoted: [],
      expired: [],
      scenesCreated: [],
      scenesUpdated: [],
      embedded: 0,
    };
    const base: MemoryFilter = options.allProjects
      ? { allProjects: true }
      : this.scopeFilter(options);
    // Expiry: archive memories whose expiresAt has passed.
    const expired = await this.store.list({
      ...base,
      includeExpired: true,
      createdBefore: new Date(),
      limit: 10_000,
    });
    for (const m of expired) {
      if (m.expiresAt && m.expiresAt.getTime() <= Date.now() && m.status !== "archived") {
        await this.store.updateMemory(m.id, {
          status: "archived",
          metadata: withHistory(m.metadata, historyEntry("archived", "expired")),
        });
        result.expired.push(m.id);
      }
    }
    // Promotion / demotion / scenes over active memories, paginated.
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.store.list({
        ...base,
        limit: pageSize,
        offset,
        orderBy: "createdAt",
        order: "asc",
      });
      for (const m of page) {
        if (m.level === "core" && m.status !== "active") {
          await this.demote(m.id, "no longer active");
          result.demoted.push(m.id);
          continue;
        }
        if (
          this.config.memory.autoPromotion &&
          m.level === "atomic" &&
          evaluatePromotion(m, this.config.memory.promotion).eligible
        ) {
          await this.promote(m.id, "consolidation");
          result.promoted.push(m.id);
        }
        if (this.config.memory.autoScenes) {
          const s = await assignScene(this.store, m).catch(() => null);
          if (s) (s.created ? result.scenesCreated : result.scenesUpdated).push(s.scene.id);
        }
      }
      if (page.length < pageSize) break;
    }
    result.embedded = await this.embedPending();
    return result;
  }

  async stats(): Promise<MemoryStats> {
    return this.store.stats();
  }

  privacy(): PrivacyInfo {
    const provider = this.embeddings;
    const net = provider?.requiresNetwork ? "required" : "disabled";
    return {
      storage: "local",
      storagePath: this.store.location,
      telemetry: "disabled",
      analytics: "disabled",
      cloudSync: "disabled",
      embeddings: provider ? `${provider.name} (${provider.model})` : "none",
      embeddingsNetwork: net,
      network: net === "required" ? "embeddings-only" : "disabled",
      encryption: "none (SQLite file; see docs/security-privacy.md)",
    };
  }

  async export(options: { includeEmbeddings?: boolean } = {}): Promise<ExportData> {
    return this.store.exportAll(options);
  }

  async import(data: ExportData, options: ImportOptions = {}): Promise<ImportResult> {
    if (!data || data.version !== 1 || !Array.isArray(data.memories)) {
      throw new InvalidInputError("Invalid export data: expected { version: 1, memories: [...] }.");
    }
    const r: ImportResult = {
      projects: 0,
      sessions: 0,
      events: 0,
      memories: 0,
      scenes: 0,
      embeddings: 0,
      skipped: 0,
    };
    await this.store.transaction(async () => {
      for (const p of data.projects ?? []) {
        await this.store.upsertProject({
          id: p.id,
          name: p.name,
          description: p.description,
          rootPath: p.rootPath,
          metadata: p.metadata,
        });
        r.projects++;
      }
      for (const s of data.sessions ?? []) {
        await this.store.upsertSession({
          id: s.id,
          projectId: s.projectId,
          agent: s.agent,
          startedAt: toDate(s.startedAt),
          endedAt: toDate(s.endedAt),
          metadata: s.metadata,
        });
        r.sessions++;
      }
      const newEvents = [];
      for (const e of data.events ?? []) {
        if (await this.store.getEvent(e.id)) {
          r.skipped++;
          continue;
        }
        newEvents.push({ ...e, createdAt: toDate(e.createdAt) });
      }
      await this.store.createEvents(newEvents);
      r.events += newEvents.length;
      for (const m of data.memories) {
        const existing = await this.store.getMemory(m.id);
        const record = {
          ...m,
          createdAt: toDate(m.createdAt),
          updatedAt: toDate(m.updatedAt),
          expiresAt: toDate(m.expiresAt),
          lastAccessedAt: toDate(m.lastAccessedAt),
          contentHash: m.contentHash ?? contentHash(m.content),
          sourceIds: m.sourceIds ?? [],
          tags: m.tags ?? [],
          metadata: m.metadata ?? {},
          sensitive: m.sensitive ?? false,
        };
        if (existing) {
          if (!options.overwrite) {
            r.skipped++;
            continue;
          }
          await this.store.updateMemory(m.id, record);
        } else {
          await this.store.createMemory(record);
        }
        r.memories++;
      }
      for (const s of data.scenes ?? []) {
        const existing =
          (await this.store.getScene(s.id)) ??
          (await this.store.getSceneByName(s.name, s.projectId));
        if (existing) {
          await this.store.addSceneMemories(existing.id, s.memoryIds);
          if (options.overwrite)
            await this.store.updateScene(existing.id, {
              summary: s.summary,
              keywords: s.keywords,
              metadata: s.metadata,
            });
        } else {
          await this.store.createScene({
            id: s.id,
            name: s.name,
            summary: s.summary,
            projectId: s.projectId,
            keywords: s.keywords,
            memoryIds: s.memoryIds,
            metadata: s.metadata,
          });
        }
        r.scenes++;
      }
      if (options.includeEmbeddings !== false && data.embeddings?.length) {
        await this.store.setEmbeddings(
          data.embeddings.map((e) => ({
            memoryId: e.memoryId,
            model: e.model,
            vector: Float32Array.from(e.vector),
          })),
        );
        r.embeddings = data.embeddings.length;
      }
    });
    return r;
  }
}

export function defaultImportance(type: string): number {
  switch (type) {
    case "architecture":
    case "decision":
    case "constraint":
      return 0.8;
    case "convention":
    case "preference":
    case "persona":
    case "project_context":
      return 0.7;
    case "lesson":
    case "bug_fix":
    case "pattern":
      return 0.6;
    case "task":
    case "summary":
      return 0.4;
    default:
      return 0.5;
  }
}
