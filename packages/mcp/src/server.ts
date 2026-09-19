import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  formatMemoriesForPrompt,
  MemoryError,
  type MemoryEngine,
  type MemoryScope,
  type MemoryStatus,
} from "@ai-agent-memory/core";
import { readFileSync } from "node:fs";
import { z } from "zod";

export const MCP_SERVER_NAME = "ai-memory";

/** Server version reported to MCP clients (read from package.json, never hardcoded). */
function packageVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    if (typeof version === "string" && /^\d+\.\d+\.\d+/.test(version)) return version;
  } catch {
    // Unexpected layout; fall through to the dev fallback below.
  }
  return "0.0.0-dev";
}

export const MCP_SERVER_VERSION = packageVersion();

const scopeSchema = z.enum(["global", "user", "project", "workspace", "session"]);
const statusSchema = z.enum(["active", "superseded", "conflicted", "archived"]);

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(data: unknown, text?: string): ToolResult {
  const structured = Array.isArray(data) ? { items: data } : (data as Record<string, unknown>);
  return {
    content: [{ type: "text", text: text ?? JSON.stringify(data, null, 2) }],
    structuredContent: structured,
  };
}

function fail(err: unknown): ToolResult {
  const e = err as MemoryError;
  const msg =
    e instanceof MemoryError
      ? `${e.code}: ${e.message}${e.hint ? ` (${e.hint})` : ""}`
      : (err as Error).message;
  return { content: [{ type: "text", text: msg }], isError: true };
}

const guard =
  <A>(fn: (args: A) => Promise<ToolResult>) =>
  async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err);
    }
  };

const projectArg = z
  .string()
  .optional()
  .describe("Project name to scope to (defaults to the server's active project)");

/**
 * Build an MCP server that exposes the local memory engine. Every tool is a
 * thin wrapper over MemoryEngine: no agent-specific logic lives here.
 */
export function createMcpServer(engine: MemoryEngine): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: buildInstructions(engine) },
  );

  server.registerTool(
    "memory_search",
    {
      title: "Search memories",
      description:
        "Pure relevance search over the local memory store (keyword FTS5, plus semantic when embeddings are configured). Does not record access. Use memory_recall when preparing context for a task.",
      inputSchema: {
        query: z.string().min(1).describe("Free-text query"),
        project: projectArg,
        limit: z.number().int().min(1).max(100).optional().describe("Max results (default 10)"),
        type: z
          .string()
          .optional()
          .describe("Filter by memory type, e.g. decision, preference, architecture"),
        mode: z.enum(["keyword", "semantic", "hybrid"]).optional(),
        allProjects: z.boolean().optional().describe("Search across all projects (default false)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async (a) => {
      const results = await engine.search({
        query: a.query,
        projectId: a.project,
        limit: a.limit,
        type: a.type,
        mode: a.mode,
        allProjects: a.allProjects,
      });
      return ok(
        results.map(slim),
        formatMemoriesForPrompt(results, {
          header: `## Search results for "${a.query}"`,
          includeScores: true,
        }),
      );
    }),
  );

  server.registerTool(
    "memory_recall",
    {
      title: "Recall memories for a task",
      description:
        "Retrieve the most useful memories for a query, ranked by relevance, importance, confidence, recency and project match. Records access so frequently useful memories get promoted. Call this at the start of a task.",
      inputSchema: {
        query: z.string().min(1).describe("What you are about to work on, or a question"),
        project: projectArg,
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
        type: z.string().optional(),
        includeCore: z
          .boolean()
          .optional()
          .describe("Always include top core memories for the project (default true)"),
        format: z
          .enum(["json", "markdown"])
          .optional()
          .describe("Text rendering of the result (default markdown)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guard(async (a) => {
      const results = await engine.recall({
        query: a.query,
        projectId: a.project,
        limit: a.limit,
        type: a.type,
        includeCore: a.includeCore ?? true,
      });
      const text =
        a.format === "json"
          ? JSON.stringify(results.map(slim), null, 2)
          : formatMemoriesForPrompt(results, { header: "## Relevant memories" });
      return ok(results.map(slim), text);
    }),
  );

  server.registerTool(
    "memory_remember",
    {
      title: "Remember durable knowledge",
      description:
        "Store a durable fact, decision, preference, convention, architecture note, lesson or constraint. Duplicates are merged and conflicting values supersede older ones (the old memory is kept and linked). Do NOT store transient task chatter.",
      inputSchema: {
        content: z.string().min(3).max(10_000).describe("One clear, self-contained statement"),
        type: z
          .string()
          .optional()
          .describe(
            "fact | preference | decision | architecture | convention | pattern | bug_fix | lesson | task | constraint | persona | project_context | summary | custom",
          ),
        project: projectArg,
        scope: scopeSchema
          .optional()
          .describe("global | user | project (default) | workspace | session"),
        importance: z.number().min(0).max(1).optional(),
        confidence: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
        scene: z
          .string()
          .optional()
          .describe("Group under a named scene/topic, e.g. 'Payroll Architecture'"),
        ttlMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Expire after this many milliseconds"),
        sensitive: z.boolean().optional().describe("Never send to network embedding providers"),
        sessionId: z.string().optional(),
        agent: z.string().optional().describe("Name of the agent storing this memory"),
        sourceIds: z
          .array(z.string())
          .optional()
          .describe("Raw event ids this memory is derived from"),
        force: z.boolean().optional().describe("Skip dedup/conflict detection"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guard(async (a) => {
      const r = await engine.remember({ ...a, projectId: a.project, agent: a.agent ?? "mcp" });
      return ok(
        { action: r.action, relatedId: r.relatedId ?? null, memory: r.memory },
        `${r.action}: ${r.memory.id} — ${r.memory.content}${r.relatedId ? ` (related ${r.relatedId})` : ""}`,
      );
    }),
  );

  server.registerTool(
    "memory_update",
    {
      title: "Update a memory",
      description:
        "Change content, type, importance, confidence, tags, status or expiry of an existing memory. Accepts full ids or unique prefixes.",
      inputSchema: {
        id: z.string().min(4),
        content: z.string().min(1).optional(),
        type: z.string().optional(),
        scope: scopeSchema.optional(),
        importance: z.number().min(0).max(1).optional(),
        confidence: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
        status: statusSchema.optional(),
        level: z.enum(["atomic", "core"]).optional(),
        expiresAt: z.string().nullable().optional().describe("ISO date, or null to clear"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guard(async ({ id, ...patch }) => {
      const m = await engine.update(id, {
        ...patch,
        scope: patch.scope as MemoryScope | undefined,
        status: patch.status as MemoryStatus | undefined,
      });
      return ok(m, `updated ${m.id} — ${m.content}`);
    }),
  );

  server.registerTool(
    "memory_forget",
    {
      title: "Forget a memory",
      description:
        "Delete a memory (raw events are kept for provenance) or archive it with archive=true.",
      inputSchema: { id: z.string().min(4), archive: z.boolean().optional() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    guard(async (a) => {
      const r = await engine.forget(a.id, { archive: a.archive });
      return ok(r, r.archived ? `archived ${r.id}` : `forgot ${r.id}`);
    }),
  );

  server.registerTool(
    "memory_inspect",
    {
      title: "Inspect a memory",
      description:
        "Show a memory with its provenance (raw events), scenes, supersedes/superseded-by links, related memories and lifecycle history.",
      inputSchema: { id: z.string().min(4) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async (a) => {
      const i = await engine.inspect(a.id);
      return ok(i);
    }),
  );

  server.registerTool(
    "memory_list",
    {
      title: "List memories",
      description: "List memories with filters and pagination.",
      inputSchema: {
        project: projectArg,
        type: z.string().optional(),
        scope: scopeSchema.optional(),
        level: z.enum(["atomic", "core"]).optional(),
        status: statusSchema.optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional(),
        orderBy: z
          .enum(["createdAt", "updatedAt", "importance", "accessCount", "lastAccessedAt"])
          .optional(),
        allProjects: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async (a) => {
      const items = await engine.list({ ...a, projectId: a.project });
      return ok(items, formatMemoriesForPrompt(items, { header: `## Memories (${items.length})` }));
    }),
  );

  server.registerTool(
    "memory_ingest",
    {
      title: "Ingest a conversation",
      description:
        "Automatic memory mode: store raw messages as events (L0) and conservatively extract durable knowledge into memories with provenance. Use at the end of a session or after a milestone.",
      inputSchema: {
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant", "system", "tool"]),
              content: z.string(),
              kind: z.string().optional(),
            }),
          )
          .min(1),
        project: projectArg,
        sessionId: z.string().optional(),
        agent: z.string().optional(),
        rawOnly: z.boolean().optional().describe("Only store raw events, do not extract"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    guard(async (a) => {
      const r = await engine.ingest({
        messages: a.messages,
        projectId: a.project,
        sessionId: a.sessionId,
        agent: a.agent ?? "mcp",
        rawOnly: a.rawOnly,
      });
      const data = {
        events: r.events.length,
        candidates: r.candidates.length,
        skipped: r.skipped,
        stored: r.results.map((x) => ({
          action: x.action,
          id: x.memory.id,
          type: x.memory.type,
          content: x.memory.content,
        })),
      };
      return ok(data);
    }),
  );

  server.registerTool(
    "memory_status",
    {
      title: "Memory status",
      description:
        "Database statistics, active project and privacy posture of the local memory store.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guard(async () =>
      ok({ ...(await engine.stats()), project: engine.project ?? null, privacy: engine.privacy() }),
    ),
  );

  return server;
}

function slim(r: {
  memory: {
    id: string;
    content: string;
    type: string;
    scope: string;
    projectId?: string;
    level: string;
    importance: number;
    confidence: number;
    tags: string[];
    updatedAt: Date;
  };
  score: number;
  source: string;
  explanation?: string;
}) {
  const m = r.memory;
  return {
    id: m.id,
    content: m.content,
    type: m.type,
    scope: m.scope,
    project: m.projectId ?? null,
    level: m.level,
    importance: m.importance,
    confidence: m.confidence,
    tags: m.tags,
    updatedAt: m.updatedAt,
    score: r.score,
    source: r.source,
    explanation: r.explanation,
  };
}

export function buildInstructions(engine: MemoryEngine): string {
  return [
    "ai-memory gives you a persistent, local memory shared with other agents on this machine.",
    `Active project: ${engine.project ?? "(none — pass project explicitly or memories go to user scope)"}.`,
    "Workflow: call memory_recall at the start of a task with a short description of what you are doing;",
    "call memory_remember only for durable knowledge (decisions, preferences, architecture, conventions, lessons, constraints), never for transient task state;",
    "if the user corrects a previous fact, remember the new fact — the old one is superseded automatically, not deleted.",
    "Use memory_inspect to see where a memory came from and memory_forget when the user asks to delete one.",
  ].join(" ");
}
