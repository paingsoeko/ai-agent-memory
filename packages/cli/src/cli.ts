import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  DEFAULT_CONFIG,
  MemoryError,
  createMemory,
  loadConfig,
  userConfigPath,
  type CreateMemoryOptions,
  type ExportData,
  type IngestMessage,
  type ListOptions,
  type MemoryEngine,
  type MemoryScope,
  type MemoryStatus,
} from "@ai-agent-memory/core";
import "@ai-agent-memory/embeddings";
import {
  formatEvent,
  formatInspection,
  formatList,
  formatResults,
  formatScene,
  formatStats,
  kv,
} from "./format.js";
import { defaultIO, type CliIO } from "./io.js";

export const VERSION = "0.1.0";

const OPTIONS = {
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", short: "v", default: false },
  verbose: { type: "boolean", default: false },
  project: { type: "string", short: "p" },
  db: { type: "string" },
  config: { type: "string" },
  global: { type: "boolean", short: "g", default: false },
  "all-projects": { type: "boolean", default: false },
  type: { type: "string", short: "t" },
  importance: { type: "string" },
  confidence: { type: "string" },
  scope: { type: "string" },
  tags: { type: "string" },
  scene: { type: "string" },
  force: { type: "boolean", default: false },
  sensitive: { type: "boolean", default: false },
  ttl: { type: "string" },
  limit: { type: "string", short: "n" },
  offset: { type: "string" },
  mode: { type: "string" },
  core: { type: "boolean", default: false },
  level: { type: "string" },
  status: { type: "string" },
  archive: { type: "boolean", default: false },
  content: { type: "string" },
  embeddings: { type: "boolean", default: false },
  overwrite: { type: "boolean", default: false },
  session: { type: "string" },
  agent: { type: "string" },
  "raw-only": { type: "boolean", default: false },
  path: { type: "string" },
  "order-by": { type: "string" },
  port: { type: "string" },
  host: { type: "string" },
  static: { type: "string" },
  open: { type: "boolean", default: false },
  summary: { type: "string" },
  name: { type: "string" },
  "include-expired": { type: "boolean", default: false },
  "from-hook": { type: "boolean", default: false },
} as const;

type Parsed = ReturnType<
  typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>
>["values"];

const HELP = `aam ${VERSION} — local-first, agent-agnostic memory for AI coding agents

Usage: aam <command> [options]

Commands
  init                         Create the local database and default config
  status                       Show database statistics and configuration
  remember <text>              Store a memory (dedup + conflict detection applied)
  recall <query>               Retrieve memories ranked for an agent (records access)
  search <query>               Pure relevance search (keyword/semantic/hybrid)
  list                         List memories (filters: --type --scope --level --status)
  inspect <id>                 Show provenance, history, scenes and related memories
  update <id>                  Update fields (--content --type --importance --tags ...)
  forget <id>                  Delete a memory (or --archive to keep it hidden)
  promote <id> | demote <id>   Move a memory to/from core (L3)
  project create|use|list|current|delete
  scene list|show <id>
  events                       List raw events (L0)
  ingest [file]                Ingest a JSON/JSONL conversation (or stdin) automatically
  consolidate                  Run expiry, promotion, scene clustering and embedding backfill
  embed                        Backfill embeddings for the configured provider
  export [file]                Export the whole database as JSON (stdout when omitted)
  import <file>                Import a JSON export (use --overwrite to replace)
  privacy                      Show the privacy posture
  config                       Show effective configuration and where it came from
  mcp                          Show how to run the MCP server
  serve                        Start the local web UI + REST API (http://127.0.0.1:4123)

Global options
  --json                Machine-readable JSON output
  -p, --project <name>  Project scope (default: .ai-memory.json or git root name)
  -g, --global          Ignore the project (user scope)
  --all-projects        Do not isolate by project (list/search/consolidate)
  --db <path>           Database path (default ~/.ai-memory/memory.db)
  --config <path>       Config file path
  --verbose             Show ranking explanations
  -h, --help            Show help
  -v, --version         Show version

Command options
  remember: -t, --type <t> --importance <0-1> --confidence <0-1> --scope <s> --tags a,b --scene <name> --ttl 7d --force --sensitive
  recall/search: -n, --limit <n> --offset <n> --mode keyword|semantic|hybrid -t, --type <t> --core (recall)
  list: -t --scope --level atomic|core --status active|superseded|conflicted|archived --order-by createdAt|updatedAt|importance|accessCount -n --offset --include-expired
  ingest: --session <id> --agent <name> --raw-only --from-hook (stdin/arg is an agent hook payload: Claude Code Stop JSON with transcript_path, or Codex notify JSON)
  export: --embeddings     import: --overwrite

Examples
  aam init
  aam remember "I prefer PostgreSQL for backend projects." -t preference
  aam recall "database preference" --json
  aam project use my-app
`;

function num(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (Number.isNaN(n))
    throw new MemoryError("INVALID_INPUT", `--${name} must be a number, got "${v}"`);
  return n;
}

function parseTtl(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^(\d+)\s*(ms|s|m|h|d|w)?$/i.exec(v.trim());
  if (!m) throw new MemoryError("INVALID_INPUT", `--ttl must look like 30m, 12h, 7d (got "${v}")`);
  const n = Number(m[1]);
  const unit = (m[2] ?? "ms").toLowerCase();
  const mult: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return n * mult[unit]!;
}

function csv(v: string | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function listOptions(v: Parsed): ListOptions {
  return {
    type: csv(v.type),
    scope: csv(v.scope) as MemoryScope[] | undefined,
    level: csv(v.level) as ListOptions["level"],
    status: csv(v.status) as MemoryStatus[] | undefined,
    limit: num(v.limit, "limit"),
    offset: num(v.offset, "offset"),
    orderBy: v["order-by"] as ListOptions["orderBy"],
    allProjects: v["all-projects"],
    includeExpired: v["include-expired"],
    tags: csv(v.tags),
    sessionId: v.session,
    agent: v.agent,
  };
}

async function open(v: Parsed, io: CliIO): Promise<MemoryEngine> {
  const opts: CreateMemoryOptions = { cwd: io.cwd, env: io.env, configPath: v.config };
  if (v.db) opts.path = resolve(io.cwd, v.db);
  if (v.project) opts.project = v.project;
  if (v.global) opts.memory = { autoDetectProject: false };
  const engine = await createMemory(opts);
  if (v.global) engine.config.project = undefined;
  return engine;
}

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function writeProjectConfig(cwd: string, project: string) {
  const file = join(cwd, ".ai-memory.json");
  let existing: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      existing = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      throw new MemoryError(
        "CONFIG",
        `${file} is not valid JSON`,
        "Fix or delete the file, then retry.",
      );
    }
  }
  writeFileSync(file, JSON.stringify({ ...existing, project }, null, 2) + "\n");
  return file;
}

async function readInput(io: CliIO, file: string | undefined): Promise<string> {
  if (file && file !== "-") {
    const p = resolve(io.cwd, file);
    if (!existsSync(p)) throw new MemoryError("INVALID_INPUT", `File not found: ${p}`);
    return readFileSync(p, "utf8");
  }
  const text = (await io.stdin?.()) ?? "";
  if (!text.trim())
    throw new MemoryError("INVALID_INPUT", "No input: pass a file path or pipe JSON on stdin.");
  return text;
}

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((c) =>
        typeof c === "string"
          ? c
          : (c as { type?: string; text?: string }).type === "text"
            ? ((c as { text?: string }).text ?? "")
            : "",
      )
      .filter(Boolean);
    return parts.length ? parts.join("\n") : null;
  }
  return null;
}

/** Normalise one record into an ingest message. Understands plain {role, content} and Claude Code transcript lines ({type, message:{role, content}}). */
function toMessage(m: Record<string, unknown>): IngestMessage | null {
  const inner = (
    m.message && typeof m.message === "object" ? (m.message as Record<string, unknown>) : m
  ) as Record<string, unknown>;
  const role = (inner.role ?? m.type ?? "user") as string;
  if (!["user", "assistant", "system", "tool"].includes(role)) return null;
  const content = textOf(inner.content);
  if (!content || !content.trim()) return null;
  // Claude Code tool results are user-role entries whose content is tool_result blocks; textOf() drops them.
  return {
    role: role as IngestMessage["role"],
    content,
    kind: m.kind as string | undefined,
    createdAt: (m.createdAt ?? m.timestamp) as string | undefined,
    metadata: (m.metadata as Record<string, unknown>) ?? {},
  };
}

export function parseMessages(text: string): IngestMessage[] {
  const trimmed = text.trim();
  let raw: unknown;
  const parseLines = () =>
    trimmed
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as unknown;
        } catch {
          throw new MemoryError("INVALID_INPUT", "Input is neither JSON nor JSONL.");
        }
      });
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      raw = JSON.parse(trimmed);
    } catch {
      raw = parseLines();
    }
  } else raw = parseLines();
  const obj = raw as { messages?: unknown; role?: unknown; message?: unknown };
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(obj.messages)
      ? obj.messages
      : obj.role || obj.message
        ? [raw]
        : null;
  if (!list)
    throw new MemoryError(
      "INVALID_INPUT",
      "Expected a JSON array of {role, content} messages, JSONL, or {messages: [...]}",
    );
  const out: IngestMessage[] = [];
  for (const item of list as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const msg = toMessage(item as Record<string, unknown>);
    if (msg) out.push(msg);
  }
  if (out.length === 0)
    throw new MemoryError("INVALID_INPUT", "No messages with text content found in input.");
  return out;
}

/**
 * Turn an agent hook payload into messages.
 * - Claude Code (Stop/SessionEnd hook JSON on stdin): { transcript_path, session_id } -> read JSONL transcript
 * - Codex notify (JSON argv): { type: "agent-turn-complete", "input-messages": [...], "last-assistant-message": "..." }
 * - Anything else that already contains messages/transcript
 */
export function messagesFromHookPayload(
  payload: Record<string, unknown>,
  cwd: string,
): { messages: IngestMessage[]; sessionId?: string } {
  const sessionId = (payload.session_id ??
    payload.sessionId ??
    payload["thread-id"] ??
    payload["turn-id"]) as string | undefined;
  const transcript = (payload.transcript_path ?? payload.transcriptPath) as string | undefined;
  if (transcript) {
    const p = resolve(cwd, transcript);
    if (!existsSync(p)) throw new MemoryError("INVALID_INPUT", `Transcript not found: ${p}`);
    return { messages: parseMessages(readFileSync(p, "utf8")), sessionId };
  }
  const inputs = (payload["input-messages"] ??
    payload.input_messages ??
    payload.messages) as unknown;
  const last = (payload["last-assistant-message"] ?? payload.last_assistant_message) as
    string | undefined;
  const messages: IngestMessage[] = [];
  if (Array.isArray(inputs)) {
    for (const i of inputs) {
      if (typeof i === "string") messages.push({ role: "user", content: i });
      else if (i && typeof i === "object") {
        const m = toMessage(i as Record<string, unknown>);
        if (m) messages.push(m);
      }
    }
  }
  if (typeof last === "string" && last.trim()) messages.push({ role: "assistant", content: last });
  if (messages.length === 0)
    throw new MemoryError(
      "INVALID_INPUT",
      "Hook payload contained no transcript_path or messages.",
    );
  return { messages, sessionId };
}

/**
 * Run the CLI in-process. Returns the exit code. All output goes through `io`
 * so tests can capture it and agents can rely on stable JSON with `--json`.
 */
export async function runCli(argv: string[], io: CliIO = defaultIO()): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    io.stderr(`error: ${(err as Error).message}`);
    io.stderr("Run `aam --help` for usage.");
    return 2;
  }
  const v = parsed.values;
  const [command, ...rest] = parsed.positionals;
  const json = v.json;
  const out = (data: unknown, text: () => string) => io.stdout(json ? serialize(data) : text());

  if (v.version) {
    io.stdout(json ? serialize({ version: VERSION }) : VERSION);
    return 0;
  }
  if (!command || v.help || command === "help") {
    io.stdout(HELP);
    return 0;
  }

  let engine: MemoryEngine | null = null;
  try {
    switch (command) {
      case "init": {
        const cfgPath = v.config ? resolve(io.cwd, v.config) : userConfigPath(io.env);
        let wroteConfig = false;
        if (!existsSync(cfgPath)) {
          mkdirSync(dirname(cfgPath), { recursive: true });
          const cfg = {
            storage: { type: "sqlite", path: v.path ?? v.db ?? DEFAULT_CONFIG.storage.path },
            search: { keyword: true, semantic: false },
            embeddings: { provider: "none" },
            memory: { defaultScope: "project", autoPromotion: true },
            privacy: { telemetry: false, allowNetworkEmbeddings: false },
          };
          writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
          wroteConfig = true;
        }
        engine = await open(
          {
            ...v,
            config: v.config ?? (existsSync(cfgPath) ? cfgPath : undefined),
            db: v.db ?? v.path,
          },
          io,
        );
        const stats = await engine.stats();
        const result = {
          database: engine.store.location,
          config: cfgPath,
          configCreated: wroteConfig,
          project: engine.project ?? null,
          memories: stats.memories,
        };
        out(result, () =>
          [
            `✓ Memory database ready: ${result.database}`,
            wroteConfig ? `✓ Config created: ${cfgPath}` : `• Config: ${cfgPath}`,
            result.project
              ? `• Active project: ${result.project}`
              : "• No project detected (memories go to user scope; use `aam project use <name>`)",
            "",
            "Next steps:",
            '  aam remember "I prefer PostgreSQL for backend projects."',
            '  aam recall "database preference"',
            "  aam mcp   # connect Claude Code / Codex / Gemini CLI / OpenCode",
          ].join("\n"),
        );
        return 0;
      }
      case "status": {
        engine = await open(v, io);
        const stats = await engine.stats();
        const data = {
          ...stats,
          project: engine.project ?? null,
          embeddingsProvider: engine.embeddings?.model ?? "none",
          configSources: engine.config.sources,
        };
        out(data, () =>
          [
            formatStats(stats),
            kv([
              ["Project", engine!.project ?? "(none)"],
              [
                "Embeddings",
                engine!.embeddings
                  ? `${engine!.embeddings.name} (${engine!.embeddings.model})`
                  : "none (keyword search only)",
              ],
              ["Config from", (engine!.config.sources ?? []).join(", ")],
            ]),
          ].join("\n"),
        );
        return 0;
      }
      case "remember": {
        const content = rest.join(" ").trim();
        if (!content)
          throw new MemoryError(
            "INVALID_INPUT",
            "Nothing to remember.",
            'Usage: aam remember "text" [--type preference]',
          );
        engine = await open(v, io);
        const r = await engine.remember({
          content,
          type: v.type,
          scope: v.scope as MemoryScope | undefined,
          importance: num(v.importance, "importance"),
          confidence: num(v.confidence, "confidence"),
          tags: csv(v.tags),
          scene: v.scene,
          ttlMs: parseTtl(v.ttl),
          force: v.force,
          sensitive: v.sensitive || undefined,
          sessionId: v.session,
          agent: v.agent ?? "cli",
        });
        out(
          {
            action: r.action,
            relatedId: r.relatedId ?? null,
            similarity: r.similarity ?? null,
            memory: r.memory,
          },
          () => {
            const verb = {
              created: "Remembered",
              merged: "Merged into existing memory",
              superseded: "Remembered (supersedes an older memory)",
              conflicted: "Remembered (conflict flagged)",
            }[r.action];
            return `${verb}: ${r.memory.id}\n  [${r.memory.type} | ${r.memory.projectId ? "project:" + r.memory.projectId : r.memory.scope}${r.memory.level === "core" ? " | core" : ""}] ${r.memory.content}${r.relatedId ? `\n  related: ${r.relatedId}` : ""}`;
          },
        );
        return 0;
      }
      case "recall":
      case "search": {
        const query = rest.join(" ").trim();
        if (!query) throw new MemoryError("INVALID_INPUT", `Usage: aam ${command} "<query>"`);
        engine = await open(v, io);
        const base = {
          query,
          ...listOptions(v),
          mode: v.mode as "keyword" | "semantic" | "hybrid" | undefined,
        };
        const results =
          command === "recall"
            ? await engine.recall({ ...base, includeCore: v.core })
            : await engine.search(base);
        out(
          results.map((r) => ({
            id: r.memory.id,
            score: r.score,
            source: r.source,
            explanation: r.explanation,
            memory: r.memory,
          })),
          () => formatResults(results, v.verbose),
        );
        return 0;
      }
      case "list": {
        engine = await open(v, io);
        const memories = await engine.list(listOptions(v));
        out(memories, () => formatList(memories));
        return 0;
      }
      case "inspect": {
        const id = rest[0];
        if (!id) throw new MemoryError("INVALID_INPUT", "Usage: aam inspect <id>");
        engine = await open(v, io);
        const insp = await engine.inspect(id);
        out(insp, () => formatInspection(insp));
        return 0;
      }
      case "update": {
        const id = rest[0];
        if (!id)
          throw new MemoryError(
            "INVALID_INPUT",
            "Usage: aam update <id> [--content ...] [--type ...]",
          );
        engine = await open(v, io);
        const m = await engine.update(id, {
          content: v.content,
          type: v.type,
          scope: v.scope as MemoryScope | undefined,
          importance: num(v.importance, "importance"),
          confidence: num(v.confidence, "confidence"),
          tags: csv(v.tags),
          status: v.status as MemoryStatus | undefined,
          level: v.level as "atomic" | "core" | undefined,
          sensitive: v.sensitive || undefined,
          expiresAt: v.ttl ? new Date(Date.now() + parseTtl(v.ttl)!) : undefined,
        });
        out(m, () => `Updated ${m.id}\n  ${m.content}`);
        return 0;
      }
      case "forget": {
        const id = rest[0];
        if (!id) throw new MemoryError("INVALID_INPUT", "Usage: aam forget <id> [--archive]");
        engine = await open(v, io);
        const r = await engine.forget(id, { archive: v.archive });
        out(r, () => (r.archived ? `Archived ${r.id}` : `Forgot ${r.id} (raw events kept)`));
        return 0;
      }
      case "promote":
      case "demote": {
        const id = rest[0];
        if (!id) throw new MemoryError("INVALID_INPUT", `Usage: aam ${command} <id>`);
        engine = await open(v, io);
        const m = command === "promote" ? await engine.promote(id) : await engine.demote(id);
        out(m, () => `${m.id} is now ${m.level}`);
        return 0;
      }
      case "project": {
        const [sub, name] = rest;
        engine = await open(v, io);
        if (sub === "create") {
          if (!name) throw new MemoryError("INVALID_INPUT", "Usage: aam project create <name>");
          const p = await engine.createProject(name);
          out(p, () => `Created project ${p.name}`);
          return 0;
        }
        if (sub === "use") {
          if (!name) throw new MemoryError("INVALID_INPUT", "Usage: aam project use <name>");
          const p = await engine.createProject(name);
          const file = writeProjectConfig(io.cwd, p.name);
          out({ project: p.name, file }, () => `Using project ${p.name} (written to ${file})`);
          return 0;
        }
        if (sub === "delete") {
          if (!name) throw new MemoryError("INVALID_INPUT", "Usage: aam project delete <name>");
          await engine.store.deleteProject(name);
          out({ deleted: name }, () => `Deleted project ${name} (memories are kept)`);
          return 0;
        }
        if (sub === "current" || (!sub && !name)) {
          out({ project: engine.project ?? null }, () => engine!.project ?? "(no project)");
          return 0;
        }
        if (sub === "list") {
          const projects = await engine.listProjects();
          const counts = await Promise.all(
            projects.map((p) =>
              engine!.count({ projectId: p.id, scope: ["project", "workspace", "session"] }),
            ),
          );
          out(
            projects.map((p, i) => ({ ...p, memories: counts[i] })),
            () =>
              projects.length
                ? projects
                    .map(
                      (p, i) =>
                        `${p.name === engine!.project ? "* " : "  "}${p.name}  (${counts[i]} memories)`,
                    )
                    .join("\n")
                : "No projects.",
          );
          return 0;
        }
        throw new MemoryError(
          "INVALID_INPUT",
          `Unknown project subcommand "${sub}"`,
          "Use create, use, list, current or delete.",
        );
      }
      case "scene":
      case "scenes": {
        const [sub, id] = rest;
        engine = await open(v, io);
        if (sub === "show") {
          if (!id) throw new MemoryError("INVALID_INPUT", "Usage: aam scene show <id>");
          const scene = await engine.getScene(id);
          const members = await engine.store.getMemories(scene.memoryIds);
          out({ ...scene, memories: members }, () => formatScene(scene, members));
          return 0;
        }
        if (sub === "update") {
          if (!id)
            throw new MemoryError(
              "INVALID_INPUT",
              "Usage: aam scene update <id> --name ... --summary ...",
            );
          const scene = await engine.updateScene(id, { name: v.name, summary: v.summary });
          out(scene, () => formatScene(scene));
          return 0;
        }
        const scenes = await engine.listScenes({
          allProjects: v["all-projects"],
          limit: num(v.limit, "limit"),
        });
        out(scenes, () =>
          scenes.length ? scenes.map((s) => formatScene(s)).join("\n") : "No scenes yet.",
        );
        return 0;
      }
      case "events": {
        engine = await open(v, io);
        const events = await engine.listEvents({
          limit: num(v.limit, "limit"),
          offset: num(v.offset, "offset"),
          sessionId: v.session,
          agent: v.agent,
        });
        out(events, () => (events.length ? events.map(formatEvent).join("\n") : "No events."));
        return 0;
      }
      case "ingest": {
        let messages: IngestMessage[];
        let hookSession: string | undefined;
        if (v["from-hook"]) {
          const source = rest[0]?.trim().startsWith("{") ? rest[0]! : await readInput(io, rest[0]);
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(source) as Record<string, unknown>;
          } catch {
            throw new MemoryError("INVALID_INPUT", "Hook payload is not valid JSON.");
          }
          ({ messages, sessionId: hookSession } = messagesFromHookPayload(payload, io.cwd));
        } else {
          messages = parseMessages(await readInput(io, rest[0]));
        }
        engine = await open(v, io);
        const r = await engine.ingest({
          messages,
          sessionId: v.session ?? hookSession,
          agent: v.agent,
          rawOnly: v["raw-only"],
        });
        out(
          {
            events: r.events.length,
            candidates: r.candidates.length,
            stored: r.results.map((x) => ({
              action: x.action,
              id: x.memory.id,
              content: x.memory.content,
              type: x.memory.type,
            })),
            skipped: r.skipped,
          },
          () =>
            [
              `Stored ${r.events.length} raw events, ${r.candidates.length} candidates, ${r.results.length} memories (${r.skipped} skipped)`,
              ...r.results.map(
                (x) =>
                  `  ${x.action.padEnd(10)} ${x.memory.id.slice(0, 8)}  [${x.memory.type}] ${x.memory.content}`,
              ),
            ].join("\n"),
        );
        return 0;
      }
      case "consolidate": {
        engine = await open(v, io);
        const r = await engine.consolidate({ allProjects: v["all-projects"] });
        out(r, () =>
          kv([
            ["Promoted", r.promoted.length],
            ["Demoted", r.demoted.length],
            ["Expired", r.expired.length],
            ["Scenes created", r.scenesCreated.length],
            ["Scenes updated", r.scenesUpdated.length],
            ["Embedded", r.embedded],
          ]),
        );
        return 0;
      }
      case "embed": {
        engine = await open(v, io);
        if (!engine.embeddings)
          throw new MemoryError(
            "EMBEDDINGS",
            "No embedding provider configured.",
            'Set embeddings.provider to "hash" (local) or install @ai-agent-memory/embeddings for more.',
          );
        const n = await engine.embedPending(num(v.limit, "limit") ?? 10_000);
        out(
          { embedded: n, model: engine.embeddings.model },
          () => `Embedded ${n} memories with ${engine!.embeddings!.model}`,
        );
        return 0;
      }
      case "export": {
        engine = await open(v, io);
        const data = await engine.export({ includeEmbeddings: v.embeddings });
        const file = rest[0];
        if (file) {
          const p = resolve(io.cwd, file);
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, JSON.stringify(data, null, 2));
          out(
            { file: p, memories: data.memories.length, events: data.events.length },
            () =>
              `Exported ${data.memories.length} memories and ${data.events.length} events to ${p}`,
          );
        } else {
          io.stdout(JSON.stringify(data, null, 2));
        }
        return 0;
      }
      case "import": {
        const text = await readInput(io, rest[0]);
        let data: ExportData;
        try {
          data = JSON.parse(text) as ExportData;
        } catch {
          throw new MemoryError("INVALID_INPUT", "Import file is not valid JSON.");
        }
        engine = await open(v, io);
        const r = await engine.import(data, { overwrite: v.overwrite });
        out(
          r,
          () =>
            `Imported ${r.memories} memories, ${r.events} events, ${r.scenes} scenes, ${r.projects} projects (${r.skipped} skipped)`,
        );
        return 0;
      }
      case "privacy": {
        engine = await open(v, io);
        const p = engine.privacy();
        out(p, () =>
          kv([
            ["Storage", `${p.storage} (${p.storagePath})`],
            ["Telemetry", p.telemetry],
            ["Analytics", p.analytics],
            ["Cloud sync", p.cloudSync],
            ["Embeddings", p.embeddings],
            ["Network", p.network],
            ["Encryption", p.encryption],
          ]),
        );
        return 0;
      }
      case "config": {
        const cfg = loadConfig({
          cwd: io.cwd,
          env: io.env,
          configPath: v.config,
          overrides: v.db ? { storage: { path: resolve(io.cwd, v.db) } } : undefined,
        });
        out(
          cfg,
          () =>
            `${JSON.stringify({ ...cfg, sources: undefined }, null, 2)}\n\nLoaded from: ${(cfg.sources ?? []).join(" < ")}`,
        );
        return 0;
      }
      case "mcp": {
        const cfg = loadConfig({ cwd: io.cwd, env: io.env, configPath: v.config });
        const snippet = {
          mcpServers: {
            "ai-memory": {
              command: "npx",
              args: ["-y", "@ai-agent-memory/mcp"],
              env: { AI_MEMORY_PROJECT: cfg.project ?? "<project>" },
            },
          },
        };
        out(snippet, () =>
          [
            "Run the MCP server over stdio:",
            "  npx -y @ai-agent-memory/mcp            # or: ai-memory-mcp",
            "",
            "Claude Code:   claude mcp add ai-memory -- npx -y @ai-agent-memory/mcp",
            "Codex:         add [mcp_servers.ai-memory] to ~/.codex/config.toml",
            "Gemini CLI:    add to ~/.gemini/settings.json → mcpServers",
            "OpenCode:      add to opencode.json → mcp",
            "",
            "Generic JSON config:",
            JSON.stringify(snippet, null, 2),
            "",
            "See docs/mcp.md and docs/integrations/ for details.",
          ].join("\n"),
        );
        return 0;
      }
      case "serve": {
        const { startServer } = await import("@ai-agent-memory/server");
        const port = num(v.port, "port") ?? 4123;
        const host = v.host ?? "127.0.0.1";
        const candidates = [
          v.static ? resolve(io.cwd, v.static) : null,
          // Monorepo layout: packages/cli/dist -> ../../web/dist
          new URL("../../web/dist/index.html", import.meta.url).pathname.replace(
            /\/index\.html$/,
            "",
          ),
          // Installed layout: node_modules/@ai-agent-memory/web/dist
          resolve(io.cwd, "node_modules/@ai-agent-memory/web/dist"),
        ].filter(Boolean) as string[];
        const { existsSync: exists } = await import("node:fs");
        const staticDir = candidates.find((c) => exists(join(c, "index.html")));
        const srv = await startServer({
          port,
          host,
          staticDir,
          cwd: io.cwd,
          env: io.env,
          configPath: v.config,
          ...(v.db ? { path: resolve(io.cwd, v.db) } : {}),
          ...(v.project ? { project: v.project } : {}),
        });
        out({ url: srv.url, api: `${srv.url}/api/health` }, () =>
          [
            `✓ AI Memory UI: ${srv.url}`,
            `  REST API:      ${srv.url}/api/health`,
            staticDir
              ? ""
              : "  (web UI bundle not found — serving API only; run `pnpm --filter @ai-agent-memory/web build`)",
            "  Press Ctrl+C to stop.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        if (v.open) {
          const { execFile } = await import("node:child_process");
          const opener =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "cmd"
                : "xdg-open";
          const args = process.platform === "win32" ? ["/c", "start", srv.url] : [srv.url];
          execFile(opener, args, () => {});
        }
        // Keep the process alive until interrupted; `finally` below must not
        // close anything since this engine belongs to the server.
        await new Promise<void>((resolveStop) => {
          const stop = () => resolveStop();
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);
        });
        await srv.close();
        return 0;
      }
      default:
        io.stderr(`error: unknown command "${command}"`);
        io.stderr("Run `aam --help` for usage.");
        return 2;
    }
  } catch (err) {
    const e = err as MemoryError;
    if (json)
      io.stderr(
        serialize({ error: { code: e.code ?? "ERROR", message: e.message, hint: e.hint } }),
      );
    else {
      io.stderr(`error: ${e.message}`);
      if (e.hint) io.stderr(`hint: ${e.hint}`);
    }
    return e.code === "NOT_FOUND" ? 3 : 1;
  } finally {
    await engine?.close();
  }
}

export async function main(argv: string[]): Promise<number> {
  return runCli(argv, defaultIO());
}
