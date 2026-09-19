import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createMemory, type CreateMemoryOptions, type MemoryEngine } from "@ai-agent-memory/core";
import "@ai-agent-memory/embeddings";
import { buildMemoryGraph } from "./graph.js";

export interface ServeOptions extends CreateMemoryOptions {
  port?: number;
  host?: string;
  /** Directory holding the built web UI (served statically + SPA fallback). */
  staticDir?: string;
  /** Log requests to stdout. */
  log?: boolean;
}

export interface ApiServer {
  url: string;
  close: () => Promise<void>;
  engine: MemoryEngine;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type":
      typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

function statusForCode(code: string | undefined): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "INVALID_INPUT":
    case "CONFIG":
      return 400;
    case "AMBIGUOUS":
      return 409;
    case "UNSUPPORTED":
      return 501;
    case "EMBEDDINGS":
      return 503;
    default:
      return 500;
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function num(q: URLSearchParams, key: string, fallback: number, max = 500): number {
  const v = q.get(key);
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(0, Math.floor(n)), max);
}

function csv(q: URLSearchParams, key: string): string[] | undefined {
  const v = q.get(key);
  if (!v) return undefined;
  const parts = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function serveFile(res: ServerResponse, file: string) {
  const ext = extname(file).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
  });
  createReadStream(file).pipe(res);
}

/** Build a paginated list payload shared by every collection endpoint. */
function page<T>(data: T[], total: number, limit: number, offset: number) {
  return { data, total, limit, offset };
}

function matchedTerms(content: string, query: string): string[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9+#./_-]+/i)
    .filter((t) => t.length > 1);
  const lower = content.toLowerCase();
  const out: string[] = [];
  for (const t of terms) {
    if (lower.includes(t) && !out.includes(t)) out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

export async function startServer(options: ServeOptions = {}): Promise<ApiServer> {
  const { port = 4123, host = "127.0.0.1", staticDir, log = true, ...engineOpts } = options;
  const engine = await createMemory(engineOpts);

  const server = createHttpServer(async (req, res) => {
    const method = (req.method ?? "GET").toUpperCase();
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const path = url.pathname;
    const q = url.searchParams;

    // CORS (local UI + agent integrations may call the API directly).
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (log && !path.startsWith("/api/stats") && !url.pathname.includes(".")) {
      console.log(`${method} ${path}`);
    }

    try {
      // --- health / meta -------------------------------------------------
      if (path === "/api/health" && method === "GET") {
        send(res, 200, { ok: true, version: "0.1.2" });
        return;
      }
      if (path === "/api/stats" && method === "GET") {
        const stats = await engine.stats();
        send(res, 200, stats);
        return;
      }
      if (path === "/api/privacy" && method === "GET") {
        send(res, 200, engine.privacy());
        return;
      }
      if (path === "/api/config" && method === "GET") {
        const c = engine.config;
        send(res, 200, {
          project: c.project ?? null,
          sources: c.sources ?? [],
          storage: { type: c.storage.type, path: c.storage.path },
          search: {
            keyword: c.search.keyword,
            semantic: c.search.semantic,
            mode: engine.embeddings ? "hybrid" : "keyword",
          },
          embeddings: {
            provider: c.embeddings.provider,
            model: engine.embeddings?.model ?? c.embeddings.model ?? null,
            network: engine.embeddings?.requiresNetwork ? "required" : "disabled",
          },
          memory: {
            defaultScope: c.memory.defaultScope,
            autoPromotion: c.memory.autoPromotion,
            autoScenes: c.memory.autoScenes,
            conflictsPolicy: c.memory.conflicts.policy,
          },
          privacy: { telemetry: false, allowNetworkEmbeddings: c.privacy.allowNetworkEmbeddings },
        });
        return;
      }
      if (path === "/api/activity" && method === "GET") {
        const limit = num(q, "limit", 20, 100);
        const [events, memories] = await Promise.all([
          engine.listEvents({ limit }),
          engine.list({ limit, orderBy: "updatedAt", order: "desc", allProjects: true }),
        ]);
        const items = [
          ...events.map((e) => ({
            kind: "event" as const,
            at: e.createdAt,
            title: eventTitle(e.kind, e.agent),
            detail: e.content.slice(0, 140),
            agent: e.agent ?? null,
            sessionId: e.sessionId ?? null,
            projectId: e.projectId ?? null,
            refId: e.id,
          })),
          ...memories.map((m) => ({
            kind: "memory" as const,
            at: m.updatedAt,
            title: m.level === "core" ? "Core memory" : "Memory updated",
            detail: m.content.slice(0, 140),
            agent: m.agent ?? null,
            sessionId: m.sessionId ?? null,
            projectId: m.projectId ?? null,
            refId: m.id,
          })),
        ]
          .sort((a, b) => +new Date(b.at) - +new Date(a.at))
          .slice(0, limit);
        send(res, 200, { data: items });
        return;
      }

      // --- search ---------------------------------------------------------
      if (path === "/api/search" && method === "GET") {
        const query = (q.get("q") ?? "").trim();
        if (!query) {
          send(res, 400, { error: { code: "INVALID_INPUT", message: "Missing ?q= query" } });
          return;
        }
        const mode = (q.get("mode") as "keyword" | "semantic" | "hybrid" | null) ?? undefined;
        const limit = num(q, "limit", 20);
        const offset = num(q, "offset", 0);
        const results = await engine.search({
          query,
          mode,
          limit: limit + offset,
          projectId: q.get("project") ?? undefined,
          allProjects: q.get("all") === "1" ? true : undefined,
          type: csv(q, "type"),
          scope: csv(q, "scope") as never,
          level: csv(q, "level") as never,
          status: csv(q, "status") as never,
        });
        const sliced = results.slice(offset, offset + limit);
        send(res, 200, {
          query,
          mode: mode ?? (engine.embeddings ? "hybrid" : "keyword"),
          data: sliced.map((r) => ({
            ...r,
            matched: matchedTerms(r.memory.content, query),
          })),
          total: results.length,
          limit,
          offset,
        });
        return;
      }

      // --- memories -------------------------------------------------------
      if (path === "/api/memories" && method === "GET") {
        const query = q.get("q")?.trim();
        const limit = num(q, "limit", 50, 500);
        const offset = num(q, "offset", 0, 100_000);
        const filter = {
          projectId: q.get("project") ?? undefined,
          allProjects: q.get("all") === "1" ? true : undefined,
          scope: csv(q, "scope") as never,
          type: csv(q, "type"),
          level: csv(q, "level") as never,
          status: csv(q, "status") as never,
          agent: q.get("agent") ?? undefined,
          sessionId: q.get("session") ?? undefined,
          tags: csv(q, "tags"),
          minImportance: q.get("minImportance") ? Number(q.get("minImportance")) : undefined,
          minConfidence: q.get("minConfidence") ? Number(q.get("minConfidence")) : undefined,
          includeExpired: q.get("includeExpired") === "1",
        };
        if (query) {
          const results = await engine.search({
            query,
            mode: (q.get("mode") as never) ?? undefined,
            limit: limit + offset,
            ...filter,
          });
          const sliced = results.slice(offset, offset + limit);
          send(res, 200, {
            data: sliced.map((r) => r.memory),
            total: results.length,
            limit,
            offset,
          });
          return;
        }
        const [data, total] = await Promise.all([
          engine.list({
            ...filter,
            limit,
            offset,
            orderBy: (q.get("orderBy") as never) ?? "updatedAt",
            order: (q.get("order") as "asc" | "desc" | null) ?? "desc",
          }),
          engine.count(filter),
        ]);
        send(res, 200, page(data, total, limit, offset));
        return;
      }
      if (path === "/api/memories" && method === "POST") {
        const body = await readJson(req);
        if (!body.content || typeof body.content !== "string") {
          send(res, 400, { error: { code: "INVALID_INPUT", message: "content is required" } });
          return;
        }
        const r = await engine.remember({
          content: body.content,
          type: body.type as never,
          scope: body.scope as never,
          projectId: (body.projectId ?? body.project) as string | undefined,
          workspaceId: body.workspaceId as string | undefined,
          sessionId: body.sessionId as string | undefined,
          agent: (body.agent as string | undefined) ?? "web",
          confidence: body.confidence as number | undefined,
          importance: body.importance as number | undefined,
          tags: body.tags as string[] | undefined,
          sensitive: body.sensitive as boolean | undefined,
          metadata: body.metadata as Record<string, unknown> | undefined,
          scene: body.scene as string | undefined,
          force: body.force as boolean | undefined,
        });
        send(res, 201, r);
        return;
      }
      const memMatch = /^\/api\/memories\/([^/]+)(\/.*)?$/.exec(path);
      if (memMatch) {
        const id = decodeURIComponent(memMatch[1]!);
        const rest = memMatch[2] ?? "";
        if (rest === "" && method === "GET") {
          const insp = await engine.inspect(id);
          send(res, 200, insp);
          return;
        }
        if (rest === "" && method === "PATCH") {
          const body = await readJson(req);
          const updated = await engine.update(id, {
            content: body.content as string | undefined,
            type: body.type as never,
            scope: body.scope as never,
            projectId: body.projectId === null ? null : (body.projectId as string | undefined),
            confidence: body.confidence as number | undefined,
            importance: body.importance as number | undefined,
            tags: body.tags as string[] | undefined,
            status: body.status as never,
            level: body.level as never,
            sensitive: body.sensitive as boolean | undefined,
            expiresAt: body.expiresAt as string | null | undefined,
            metadata: body.metadata as Record<string, unknown> | undefined,
          });
          send(res, 200, updated);
          return;
        }
        if (rest === "" && method === "DELETE") {
          const archive = q.get("archive") === "1" || q.get("archive") === "true";
          const r = await engine.forget(id, { archive });
          send(res, 200, r);
          return;
        }
        if (rest === "/promote" && method === "POST") {
          send(res, 200, await engine.promote(id));
          return;
        }
        if (rest === "/demote" && method === "POST") {
          send(res, 200, await engine.demote(id));
          return;
        }
        if (rest === "/resolve" && method === "POST") {
          const body = await readJson(req);
          const loser = body.loserId as string;
          if (!loser) {
            send(res, 400, { error: { code: "INVALID_INPUT", message: "loserId is required" } });
            return;
          }
          send(res, 200, await engine.resolveConflict(id, loser));
          return;
        }
        if (rest === "/supersede" && method === "POST") {
          const body = await readJson(req);
          const newer = body.newerId as string;
          if (!newer) {
            send(res, 400, { error: { code: "INVALID_INPUT", message: "newerId is required" } });
            return;
          }
          send(res, 200, await engine.supersede(id, newer));
          return;
        }
      }
      // --- memory graph (neuron network) ---------------------------------------
      if (path === "/api/memory-graph" && method === "GET") {
        const graph = await buildMemoryGraph(engine, {
          project: q.get("project") ?? undefined,
          level: q.get("level") ?? undefined,
          query: q.get("query") ?? q.get("q") ?? undefined,
          focus: q.get("focus") ?? undefined,
          depth: q.get("depth") ? Number(q.get("depth")) : undefined,
          limit: num(q, "limit", 160, 600),
        });
        send(res, 200, graph);
        return;
      }
      if (path === "/api/conflicts" && method === "GET") {
        const limit = num(q, "limit", 50, 200);
        const offset = num(q, "offset", 0);
        const [data, total] = await Promise.all([
          engine.list({
            status: "conflicted",
            limit,
            offset,
            allProjects: true,
            orderBy: "updatedAt",
            order: "desc",
          }),
          engine.count({ status: "conflicted", allProjects: true }),
        ]);
        send(res, 200, page(data, total, limit, offset));
        return;
      }

      // --- scenes ----------------------------------------------------------
      if (path === "/api/scenes" && method === "GET") {
        const limit = num(q, "limit", 50, 200);
        const offset = num(q, "offset", 0);
        const scenes = await engine.listScenes({
          projectId: q.get("project") ?? undefined,
          allProjects: q.get("all") === "1" ? true : undefined,
          limit: limit + 1,
          offset,
        });
        // SQLite listScenes has no total; estimate with hasMore.
        send(res, 200, {
          data: scenes.slice(0, limit),
          total: scenes.length > limit ? offset + limit + 1 : offset + scenes.length,
          limit,
          offset,
          hasMore: scenes.length > limit,
        });
        return;
      }
      if (path === "/api/scenes" && method === "POST") {
        const body = await readJson(req);
        if (!body.name) {
          send(res, 400, { error: { code: "INVALID_INPUT", message: "name is required" } });
          return;
        }
        send(res, 201, await engine.createScene(body as never));
        return;
      }
      const sceneMatch = /^\/api\/scenes\/([^/]+)(\/.*)?$/.exec(path);
      if (sceneMatch) {
        const id = decodeURIComponent(sceneMatch[1]!);
        const rest = sceneMatch[2] ?? "";
        if (rest === "" && method === "GET") {
          const scene = await engine.getScene(id);
          const members = await engine.store.getMemories(scene.memoryIds.slice(0, 100));
          const core = members.filter((m) => m.level === "core").length;
          send(res, 200, {
            ...scene,
            members,
            coreCount: core,
            atomicCount: members.length - core,
          });
          return;
        }
        if (rest === "" && method === "PATCH") {
          const body = await readJson(req);
          send(res, 200, await engine.updateScene(id, body as never));
          return;
        }
        if (rest === "" && method === "DELETE") {
          await engine.deleteScene(id);
          send(res, 200, { deleted: id });
          return;
        }
        if (rest === "/members" && method === "POST") {
          const body = await readJson(req);
          const ids = (body.memoryIds ?? body.ids ?? []) as string[];
          send(res, 200, await engine.addToScene(id, ids));
          return;
        }
      }

      // --- projects ---------------------------------------------------------
      if (path === "/api/projects" && method === "GET") {
        const projects = await engine.listProjects();
        const enriched = await Promise.all(
          projects.map(async (p) => {
            const [memories, scenes, events] = await Promise.all([
              engine.count({ projectId: p.id, allProjects: true }).catch(() => 0),
              engine
                .listScenes({ projectId: p.id, allProjects: true, limit: 1000 })
                .catch(() => []),
              engine.store.countEvents({ projectId: p.id }).catch(() => 0),
            ]);
            const recent = await engine.store
              .list({
                projectId: p.id,
                allProjects: true,
                limit: 1,
                orderBy: "updatedAt",
                order: "desc",
              })
              .catch(() => []);
            return {
              ...p,
              memoryCount: memories,
              sceneCount: scenes.length,
              eventCount: events,
              lastActivity: recent[0]?.updatedAt ?? p.updatedAt,
            };
          }),
        );
        send(res, 200, { data: enriched, total: enriched.length });
        return;
      }
      if (path === "/api/projects" && method === "POST") {
        const body = await readJson(req);
        if (!body.name) {
          send(res, 400, { error: { code: "INVALID_INPUT", message: "name is required" } });
          return;
        }
        send(
          res,
          201,
          await engine.createProject(body.name as string, {
            description: body.description as string | undefined,
          }),
        );
        return;
      }
      const projMatch = /^\/api\/projects\/([^/]+)$/.exec(path);
      if (projMatch && method === "GET") {
        const name = decodeURIComponent(projMatch[1]!);
        const project = await engine.getProject(name);
        if (!project) {
          send(res, 404, { error: { code: "NOT_FOUND", message: `Project "${name}" not found` } });
          return;
        }
        const [memories, scenes, events, byLevel, byType, decisions] = await Promise.all([
          engine.count({ projectId: project.id, allProjects: true }),
          engine.listScenes({ projectId: project.id, allProjects: true, limit: 100 }),
          engine.store.countEvents({ projectId: project.id }),
          engine.store
            .list({ projectId: project.id, allProjects: true, limit: 1 })
            .then(() => engine.stats())
            .catch(() => null),
          engine
            .list({
              projectId: project.id,
              allProjects: true,
              type: "decision",
              limit: 10,
              orderBy: "updatedAt",
              order: "desc",
            })
            .catch(() => []),
          engine
            .list({
              projectId: project.id,
              allProjects: true,
              level: "core",
              limit: 8,
              orderBy: "importance",
              order: "desc",
            })
            .catch(() => []),
        ]);
        void byLevel;
        send(res, 200, {
          ...project,
          memoryCount: memories,
          scenes,
          eventCount: events,
          recentDecisions: byType,
          topCore: decisions,
        });
        return;
      }

      // --- sessions ----------------------------------------------------------
      if (path === "/api/sessions" && method === "GET") {
        const limit = num(q, "limit", 50, 200);
        const sessions = await engine.store.listSessions({
          projectId: q.get("project") ?? undefined,
          limit,
        });
        const enriched = await Promise.all(
          sessions.map(async (s) => {
            const [events, memories] = await Promise.all([
              engine.store.countEvents({ sessionId: s.id }).catch(() => 0),
              engine.count({ sessionId: s.id, allProjects: true }).catch(() => 0),
            ]);
            return { ...s, sessionId: s.id, eventCount: events, memoryCount: memories };
          }),
        );
        send(res, 200, { data: enriched, total: enriched.length, limit, offset: 0 });
        return;
      }
      const sessMatch = /^\/api\/sessions\/([^/]+)$/.exec(path);
      if (sessMatch && method === "GET") {
        const id = decodeURIComponent(sessMatch[1]!);
        const session = await engine.store.getSession(id);
        if (!session) {
          send(res, 404, { error: { code: "NOT_FOUND", message: `Session "${id}" not found` } });
          return;
        }
        const [events, memories] = await Promise.all([
          engine.store.listEvents({ sessionId: session.id, limit: 100 }),
          engine.list({ sessionId: session.id, allProjects: true, limit: 50 }).catch(() => []),
        ]);
        const created = memories.filter((m) => m.sessionId === session.id);
        send(res, 200, {
          ...session,
          sessionId: session.id,
          events,
          memories: created,
          memoryCount: created.length,
          eventCount: events.length,
        });
        return;
      }

      // --- sources (raw events) ------------------------------------------------
      if ((path === "/api/sources" || path === "/api/events") && method === "GET") {
        const limit = num(q, "limit", 50, 200);
        const offset = num(q, "offset", 0);
        const filter = {
          projectId: q.get("project") ?? undefined,
          sessionId: q.get("session") ?? undefined,
          kind: q.get("kind") ?? undefined,
          agent: q.get("agent") ?? undefined,
          limit,
          offset,
        };
        const [data, total] = await Promise.all([
          engine.listEvents(filter),
          engine.store
            .countEvents({ projectId: filter.projectId, sessionId: filter.sessionId })
            .catch(() => limit),
        ]);
        send(res, 200, page(data, total, limit, offset));
        return;
      }
      const srcMatch = /^\/(api\/(sources|events))\/([^/]+)$/.exec(path);
      if (srcMatch && method === "GET") {
        const id = decodeURIComponent(srcMatch[3]!);
        const event = await engine.getEvent(id);
        if (!event) {
          send(res, 404, { error: { code: "NOT_FOUND", message: `Source "${id}" not found` } });
          return;
        }
        const linked = await engine.store.getMemoriesForEvent(id).catch(() => []);
        send(res, 200, { ...event, memories: linked });
        return;
      }

      // --- maintenance --------------------------------------------------------
      if (path === "/api/consolidate" && method === "POST") {
        send(res, 200, await engine.consolidate({ allProjects: true }));
        return;
      }
      if (path === "/api/embed" && method === "POST") {
        if (!engine.embeddings) {
          send(res, 503, {
            error: { code: "EMBEDDINGS", message: "No embedding provider configured" },
          });
          return;
        }
        const body = (await readJson(req).catch(() => ({}))) as { limit?: number };
        const n = await engine.embedPending(typeof body.limit === "number" ? body.limit : 1000);
        send(res, 200, { embedded: n, model: engine.embeddings.model });
        return;
      }
      if (path === "/api/export" && method === "GET") {
        send(res, 200, await engine.export({ includeEmbeddings: q.get("embeddings") === "1" }));
        return;
      }

      // --- static UI ------------------------------------------------------------
      if (staticDir && method === "GET" && !path.startsWith("/api/")) {
        const root = resolve(staticDir);
        const rel = decodeURIComponent(path === "/" ? "/index.html" : path);
        const file = normalize(join(root, rel));
        if (file === root || file.startsWith(root + sep)) {
          if (existsSync(file) && statSync(file).isFile()) {
            serveFile(res, file);
            return;
          }
        }
        // Unknown file with an extension (e.g. hashed asset) -> 404, so the
        // browser doesn't parse index.html as JS/CSS. Extensionless app
        // routes fall through to the SPA shell.
        if (extname(path)) {
          send(res, 404, { error: { code: "NOT_FOUND", message: `No route ${method} ${path}` } });
          return;
        }
        const fallback = join(root, "index.html");
        if (existsSync(fallback)) {
          serveFile(res, fallback);
          return;
        }
      }

      send(res, 404, { error: { code: "NOT_FOUND", message: `No route ${method} ${path}` } });
    } catch (err) {
      const e = err as { code?: string; message?: string; hint?: string };
      send(res, statusForCode(e.code), {
        error: { code: e.code ?? "ERROR", message: e.message ?? "Unexpected error", hint: e.hint },
      });
    }
  });

  await new Promise<void>((resolveListen) => server.listen(port, host, resolveListen));
  const url = `http://${host}:${port}`;
  if (log) {
    console.log(`AI Memory UI available at ${url}`);
  }
  return {
    url,
    engine,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await engine.close();
    },
  };
}

function eventTitle(kind: string, agent?: string): string {
  const who = agent ? ` · ${agent}` : "";
  switch (kind) {
    case "decision":
      return `New decision${who}`;
    case "commit":
      return `Git commit${who}`;
    case "tool_result":
      return `Tool result${who}`;
    case "task_summary":
      return `Task summary${who}`;
    case "error":
      return `Error captured${who}`;
    case "note":
      return `Note${who}`;
    default:
      return `Session activity${who}`;
  }
}
