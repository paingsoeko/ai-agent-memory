import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEMO_EVENTS,
  DEMO_MEMORIES,
  DEMO_PROJECTS,
  DEMO_SCENES,
  DEMO_SESSIONS,
  DEMO_STATS,
} from "./demo";
import type {
  ActivityItem,
  Memory,
  MemoryInspection,
  Page,
  Project,
  RawEvent,
  Scene,
  SearchResult,
  Session,
  Stats,
} from "./types";

export const params = new URLSearchParams(window.location.search);
export const DEMO_MODE = params.get("demo") === "1" || params.get("empty") === "1";
export const EMPTY_MODE = params.get("empty") === "1";
let apiDown = DEMO_MODE;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: string; hint?: string } }).error;
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, err?.code, err?.hint);
  }
  return body as T;
}

export class ApiError extends Error {
  code?: string;
  hint?: string;
  constructor(message: string, code?: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

export function isDemo(): boolean {
  return apiDown;
}

export async function checkHealth(): Promise<boolean> {
  if (DEMO_MODE) return false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    await fetch("/api/health", { signal: ctl.signal });
    clearTimeout(t);
    apiDown = false;
    return true;
  } catch {
    apiDown = true;
    return false;
  }
}

/* ---------------- queries ---------------- */

export interface MemoryQuery {
  q?: string;
  mode?: "keyword" | "semantic" | "hybrid";
  level?: string[];
  type?: string[];
  scope?: string[];
  status?: string[];
  project?: string;
  all?: boolean;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export function toParams(query: MemoryQuery): string {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  if (query.mode) p.set("mode", query.mode);
  if (query.level?.length) p.set("level", query.level.join(","));
  if (query.type?.length) p.set("type", query.type.join(","));
  if (query.scope?.length) p.set("scope", query.scope.join(","));
  if (query.status?.length) p.set("status", query.status.join(","));
  if (query.project) p.set("project", query.project);
  if (query.all) p.set("all", "1");
  if (query.sort) p.set("orderBy", query.sort);
  if (query.order) p.set("order", query.order);
  p.set("limit", String(query.limit ?? 50));
  p.set("offset", String(query.offset ?? 0));
  return p.toString();
}

function demoFilter(query: MemoryQuery): Page<Memory> {
  if (EMPTY_MODE) return { data: [], total: 0, limit: 50, offset: 0 };
  let list = [...DEMO_MEMORIES];
  const contains = (m: Memory) =>
    !query.q || m.content.toLowerCase().includes(query.q.toLowerCase());
  list = list.filter(contains);
  if (query.level?.length)
    list = list.filter(
      (m) => query.level!.includes(m.level) || (query.level!.includes("scene") && false),
    );
  if (query.type?.length) list = list.filter((m) => query.type!.includes(m.type));
  if (query.status?.length) list = list.filter((m) => query.status!.includes(m.status));
  if (query.project) list = list.filter((m) => m.projectId === query.project);
  const total = list.length;
  const offset = query.offset ?? 0;
  return {
    data: list.slice(offset, offset + (query.limit ?? 50)),
    total,
    limit: query.limit ?? 50,
    offset,
  };
}

export const api = {
  async stats(): Promise<Stats> {
    if (EMPTY_MODE)
      return {
        ...DEMO_STATS,
        memories: 0,
        events: 0,
        scenes: 0,
        projects: 0,
        byLevel: {},
        byStatus: {},
        byScope: {},
        byType: {},
      };
    if (apiDown) return DEMO_STATS;
    return req<Stats>("/api/stats");
  },
  async activity(limit = 12): Promise<ActivityItem[]> {
    if (apiDown || EMPTY_MODE) {
      if (EMPTY_MODE) return [];
      return [
        {
          kind: "memory",
          at: new Date(Date.now() - 2 * 60_000).toISOString(),
          title: "Memory updated",
          detail: "Payroll uses Temporal workflows",
          agent: "claude-code",
          sessionId: "2026-09-19-claude",
          projectId: "yoma-connect",
          refId: "mem-payroll-temporal",
        },
        {
          kind: "memory",
          at: new Date(Date.now() - 18 * 60_000).toISOString(),
          title: "New decision",
          detail: "Use JSONB for policy metadata",
          agent: "codex",
          sessionId: "2026-09-19-codex",
          projectId: "yoma-connect",
          refId: "mem-jsonb",
        },
        {
          kind: "memory",
          at: new Date(Date.now() - 60 * 60_000).toISOString(),
          title: "Scene updated",
          detail: "Payroll Architecture",
          agent: "claude-code",
          sessionId: null,
          projectId: "yoma-connect",
          refId: "scene-payroll",
        },
        {
          kind: "memory",
          at: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
          title: "Memory promoted",
          detail: "Traceparent propagation",
          agent: "claude-code",
          sessionId: null,
          projectId: "yoma-connect",
          refId: "mem-traceparent",
        },
      ];
    }
    const r = await req<{ data: ActivityItem[] }>(`/api/activity?limit=${limit}`);
    return r.data;
  },
  async memories(query: MemoryQuery): Promise<Page<Memory>> {
    if (apiDown) return demoFilter(query);
    return req<Page<Memory>>(`/api/memories?${toParams(query)}`);
  },
  async search(
    q: string,
    mode?: string,
    extra?: Partial<MemoryQuery>,
  ): Promise<{ data: SearchResult[]; total: number; mode: string }> {
    if (apiDown) {
      const page = demoFilter({ q, limit: 20, ...(extra ?? {}) });
      return {
        data: page.data.map((m, i) => ({
          memory: m,
          score: 0.95 - i * 0.04,
          source: "hybrid" as const,
          matched: q
            .toLowerCase()
            .split(/\s+/)
            .filter((t) => m.content.toLowerCase().includes(t)),
        })),
        total: page.total,
        mode: "hybrid",
      };
    }
    const p = new URLSearchParams({ q, limit: "20" });
    if (mode) p.set("mode", mode);
    if (extra?.project) p.set("project", extra.project);
    return req(`/api/search?${p.toString()}`);
  },
  async inspect(id: string): Promise<MemoryInspection> {
    if (apiDown) {
      const memory =
        DEMO_MEMORIES.find((m) => m.id === id || m.id.startsWith(id)) ?? DEMO_MEMORIES[0]!;
      const sources = DEMO_EVENTS.filter((e) => e.sessionId === memory.sessionId).slice(0, 4);
      const scenes = DEMO_SCENES.filter((s) => s.memoryIds.includes(memory.id));
      const related = DEMO_MEMORIES.filter(
        (m) => m.id !== memory.id && (m.projectId === memory.projectId || m.type === memory.type),
      ).slice(0, 4);
      return {
        memory,
        sources,
        scenes,
        supersedes: DEMO_MEMORIES.find((m) => m.id === memory.supersedes) ?? null,
        supersededBy: DEMO_MEMORIES.find((m) => m.id === memory.supersededBy) ?? null,
        related,
        history: (memory.metadata.history as MemoryInspection["history"]) ?? [
          { at: memory.createdAt, action: "created" },
        ],
      };
    }
    return req<MemoryInspection>(`/api/memories/${encodeURIComponent(id)}`);
  },
  async create(body: Record<string, unknown>) {
    return req("/api/memories", { method: "POST", body: JSON.stringify(body) });
  },
  async update(id: string, body: Record<string, unknown>): Promise<Memory> {
    if (apiDown) {
      const m = DEMO_MEMORIES.find((x) => x.id === id);
      if (!m) throw new ApiError("Memory not found", "NOT_FOUND");
      return { ...m, ...(body as Partial<Memory>), updatedAt: new Date().toISOString() };
    }
    return req<Memory>(`/api/memories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
  async remove(id: string, archive = false) {
    if (apiDown) return { id, archived: archive };
    return req(`/api/memories/${encodeURIComponent(id)}?archive=${archive ? "1" : "0"}`, {
      method: "DELETE",
    });
  },
  async promote(id: string): Promise<Memory> {
    if (apiDown) return { ...DEMO_MEMORIES.find((m) => m.id === id)! };
    return req(`/api/memories/${encodeURIComponent(id)}/promote`, { method: "POST" });
  },
  async demote(id: string): Promise<Memory> {
    if (apiDown) return { ...DEMO_MEMORIES.find((m) => m.id === id)! };
    return req(`/api/memories/${encodeURIComponent(id)}/demote`, { method: "POST" });
  },
  async resolveConflict(winnerId: string, loserId: string) {
    return req(`/api/memories/${encodeURIComponent(winnerId)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ loserId }),
    });
  },
  async scenes(): Promise<Scene[]> {
    if (apiDown) return EMPTY_MODE ? [] : DEMO_SCENES.map((s) => ({ ...s }));
    const r = await req<Page<Scene>>("/api/scenes?all=1&limit=100");
    return r.data;
  },
  async scene(id: string): Promise<Scene> {
    if (apiDown) {
      const s = DEMO_SCENES.find((x) => x.id === id) ?? DEMO_SCENES[0]!;
      return {
        ...s,
        members: DEMO_MEMORIES.filter((m) => s.memoryIds.includes(m.id)),
        coreCount: 1,
        atomicCount: s.memoryIds.length - 1,
      };
    }
    return req<Scene>(`/api/scenes/${encodeURIComponent(id)}`);
  },
  async projects(): Promise<Project[]> {
    if (apiDown) return EMPTY_MODE ? [] : DEMO_PROJECTS;
    const r = await req<{ data: Project[] }>("/api/projects");
    return r.data;
  },
  async project(id: string) {
    if (apiDown)
      return {
        ...(DEMO_PROJECTS.find((p) => p.id === id) ?? DEMO_PROJECTS[0]!),
        scenes: DEMO_SCENES,
        recentDecisions: DEMO_MEMORIES.filter((m) => m.type === "decision"),
        topCore: DEMO_MEMORIES.filter((m) => m.level === "core"),
      };
    return req(`/api/projects/${encodeURIComponent(id)}`);
  },
  async sessions(): Promise<Session[]> {
    if (apiDown) return EMPTY_MODE ? [] : DEMO_SESSIONS;
    const r = await req<{ data: Session[] }>("/api/sessions?limit=100");
    return r.data;
  },
  async session(id: string): Promise<Session> {
    if (apiDown) {
      const s = DEMO_SESSIONS.find((x) => x.id === id || x.sessionId === id) ?? DEMO_SESSIONS[0]!;
      return {
        ...s,
        events: DEMO_EVENTS.filter((e) => e.sessionId === s.sessionId),
        memories: DEMO_MEMORIES.filter((m) => m.sessionId === s.sessionId),
      };
    }
    return req<Session>(`/api/sessions/${encodeURIComponent(id)}`);
  },
  async sources(
    query: { limit?: number; offset?: number; session?: string } = {},
  ): Promise<Page<RawEvent>> {
    if (apiDown) {
      const data = EMPTY_MODE ? [] : DEMO_EVENTS;
      return { data, total: data.length, limit: query.limit ?? 50, offset: 0 };
    }
    const p = new URLSearchParams({
      limit: String(query.limit ?? 50),
      offset: String(query.offset ?? 0),
    });
    if (query.session) p.set("session", query.session);
    return req(`/api/sources?${p.toString()}`);
  },
  async source(id: string) {
    if (apiDown) {
      const e = DEMO_EVENTS.find((x) => x.id === id) ?? DEMO_EVENTS[0]!;
      return { ...e, memories: DEMO_MEMORIES.slice(0, 2) };
    }
    return req(`/api/sources/${encodeURIComponent(id)}`);
  },
  async conflicts(): Promise<Page<Memory>> {
    if (apiDown) {
      const data = EMPTY_MODE
        ? []
        : DEMO_MEMORIES.filter((m) => m.status === "conflicted" || m.status === "superseded");
      return { data, total: data.length, limit: 50, offset: 0 };
    }
    return req("/api/conflicts?limit=50");
  },
  async privacy() {
    if (apiDown)
      return {
        storage: "local",
        storagePath: "~/.ai-memory/memory.db",
        telemetry: "disabled",
        analytics: "disabled",
        cloudSync: "disabled",
        embeddings: "hash (local)",
        embeddingsNetwork: "disabled",
        network: "disabled",
        encryption: "none (SQLite file)",
      };
    return req("/api/privacy");
  },
  async config() {
    if (apiDown)
      return {
        project: "yoma-connect",
        sources: ["demo"],
        storage: { type: "sqlite", path: "~/.ai-memory/memory.db" },
        search: { keyword: true, semantic: true, mode: "hybrid" },
        embeddings: { provider: "hash", model: "hash-384", network: "disabled" },
        memory: {
          defaultScope: "project",
          autoPromotion: true,
          autoScenes: true,
          conflictsPolicy: "supersede",
        },
        privacy: { telemetry: false, allowNetworkEmbeddings: false },
      };
    return req("/api/config");
  },
};

/* ---------------- hook ---------------- */

export function useFetch<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(deps);
  const ref = useRef(fn);
  ref.current = fn;

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    ref
      .current()
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e : new ApiError(String(e)));
        setLoading(false);
      });
  }, [key]);

  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}
