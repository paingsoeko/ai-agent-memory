import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runCli, type CliIO } from "../src/index.js";

let dir: string;
let db: string;

function io(overrides: Partial<CliIO> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const cli: CliIO = {
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    cwd: dir,
    env: { XDG_CONFIG_HOME: join(dir, "cfg"), HOME: dir, AI_MEMORY_DB_PATH: db },
    ...overrides,
  };
  return { cli, out, err, text: () => out.join("\n"), errText: () => err.join("\n") };
}

async function run(args: string[], extra: Partial<CliIO> = {}) {
  const h = io(extra);
  const code = await runCli(args, h.cli);
  return { code, ...h };
}

async function json<T = unknown>(args: string[], extra: Partial<CliIO> = {}): Promise<T> {
  const r = await run([...args, "--json"], extra);
  if (r.code !== 0) throw new Error(`exit ${r.code}: ${r.errText()}`);
  return JSON.parse(r.text()) as T;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aim-cli-"));
  db = join(dir, "memory.db");
});

describe("ai-memory CLI", () => {
  it("shows help and version", async () => {
    expect((await run([])).text()).toContain("Usage: aam");
    expect((await run(["--version"])).text()).toMatch(/^\d+\.\d+\.\d+$/);
    const bad = await run(["--nope"]);
    expect(bad.code).toBe(2);
    expect(bad.errText()).toContain("--help");
  });

  it("init creates the database and config, then status reports it", async () => {
    const r = await run(["init"]);
    expect(r.code).toBe(0);
    expect(r.text()).toContain("Memory database ready");
    expect(existsSync(db)).toBe(true);
    const cfgFile = join(dir, "cfg", "ai-memory", "config.json");
    expect(existsSync(cfgFile)).toBe(true);
    expect(JSON.parse(readFileSync(cfgFile, "utf8")).privacy.telemetry).toBe(false);
    const status = await json<{ memories: number; embeddingsProvider: string }>(["status"]);
    expect(status.memories).toBe(0);
    expect(status.embeddingsProvider).toBe("none");
  });

  it("remember / recall / search / list / inspect / forget round trip with JSON output", async () => {
    const remembered = await json<{ action: string; memory: { id: string; scope: string } }>([
      "remember",
      "I prefer PostgreSQL for backend projects.",
      "-t",
      "preference",
    ]);
    expect(remembered.action).toBe("created");
    expect(remembered.memory.scope).toBe("user");
    const recalled = await json<{ id: string; score: number; memory: { content: string } }[]>([
      "recall",
      "database preference",
    ]);
    expect(recalled[0]!.memory.content).toContain("PostgreSQL");
    expect(recalled[0]!.score).toBeGreaterThan(0);
    const searched = await json<unknown[]>(["search", "postgres"]);
    expect(searched).toHaveLength(1);
    const listed = await json<{ id: string }[]>(["list", "--type", "preference"]);
    expect(listed[0]!.id).toBe(remembered.memory.id);
    const insp = await json<{ memory: { id: string }; history: { action: string }[] }>([
      "inspect",
      remembered.memory.id.slice(0, 8),
    ]);
    expect(insp.history[0]!.action).toBe("created");
    const text = await run(["inspect", remembered.memory.id]);
    expect(text.text()).toContain("Derived from");
    const forgot = await json<{ id: string; archived: boolean }>(["forget", remembered.memory.id]);
    expect(forgot.archived).toBe(false);
    const missing = await run(["inspect", remembered.memory.id]);
    expect(missing.code).toBe(3);
    expect(missing.errText()).toMatch(/not found/i);
  });

  it("manages projects and isolates memories", async () => {
    await json(["project", "create", "alpha"]);
    await json(["remember", "Alpha uses Temporal.", "-p", "alpha"]);
    await json(["remember", "Beta uses Stripe.", "-p", "beta"]);
    const alpha = await json<{ memory: { content: string } }[]>(["search", "uses", "-p", "alpha"]);
    expect(alpha.map((r) => r.memory.content)).toEqual(["Alpha uses Temporal."]);
    const all = await json<unknown[]>(["list", "--all-projects"]);
    expect(all).toHaveLength(2);
    const use = await json<{ project: string; file: string }>(["project", "use", "beta"]);
    expect(JSON.parse(readFileSync(use.file, "utf8")).project).toBe("beta");
    const current = await json<{ project: string }>(["project", "current"]);
    expect(current.project).toBe("beta");
    const projects = await json<{ name: string; memories: number }[]>(["project", "list"]);
    expect(projects.map((p) => `${p.name}:${p.memories}`)).toEqual(["alpha:1", "beta:1"]);
  });

  it("updates, promotes and reports conflicts", async () => {
    const a = await json<{ memory: { id: string } }>([
      "remember",
      "Database = MySQL",
      "-t",
      "architecture",
      "-p",
      "p",
    ]);
    const b = await json<{ action: string; relatedId: string }>([
      "remember",
      "Database = PostgreSQL",
      "-t",
      "architecture",
      "-p",
      "p",
    ]);
    expect(b.action).toBe("superseded");
    expect(b.relatedId).toBe(a.memory.id);
    const upd = await json<{ importance: number; tags: string[] }>([
      "update",
      a.memory.id,
      "--importance",
      "0.99",
      "--tags",
      "db,legacy",
      "-p",
      "p",
    ]);
    expect(upd.importance).toBe(0.99);
    expect(upd.tags).toEqual(["db", "legacy"]);
    const prom = await json<{ level: string }>(["promote", a.memory.id, "-p", "p"]);
    expect(prom.level).toBe("core");
    const superseded = await json<unknown[]>(["list", "--status", "superseded", "-p", "p"]);
    expect(superseded).toHaveLength(1);
  });

  it("ingests conversations from a file and from stdin", async () => {
    const file = join(dir, "conv.json");
    writeFileSync(
      file,
      JSON.stringify([
        { role: "user", content: "We decided to use Temporal for payroll generation." },
        { role: "assistant", content: "Great, let me look." },
      ]),
    );
    const r = await json<{ events: number; stored: { content: string }[] }>([
      "ingest",
      file,
      "-p",
      "p",
      "--agent",
      "claude",
    ]);
    expect(r.events).toBe(2);
    expect(r.stored[0]!.content).toContain("Temporal");
    const r2 = await json<{ events: number }>(["ingest", "--raw-only", "-p", "p"], {
      stdin: async () =>
        '{"role":"user","content":"line one"}\n{"role":"user","content":"line two"}',
    });
    expect(r2.events).toBe(2);
    const events = await json<unknown[]>(["events", "-p", "p"]);
    expect(events).toHaveLength(4);
  });

  it("exports and imports", async () => {
    await json(["remember", "Exported fact about caching.", "-p", "p"]);
    const file = join(dir, "out", "memory.json");
    const ex = await json<{ memories: number }>(["export", file, "-p", "p"]);
    expect(ex.memories).toBe(1);
    const db2 = join(dir, "other.db");
    const im = await json<{ memories: number }>(["import", file, "--db", db2]);
    expect(im.memories).toBe(1);
    const listed = await json<unknown[]>(["list", "--db", db2, "--all-projects"]);
    expect(listed).toHaveLength(1);
    const stdout = await run(["export", "-p", "p"]);
    expect(JSON.parse(stdout.text()).version).toBe(1);
  });

  it("privacy, config, consolidate, scenes and mcp commands work", async () => {
    const p = await json<{ telemetry: string; network: string }>(["privacy"]);
    expect(p).toMatchObject({ telemetry: "disabled", network: "disabled" });
    const cfg = await json<{ storage: { path: string }; sources: string[] }>(["config"]);
    expect(cfg.storage.path).toBe(db);
    for (const c of [
      "Authentication tokens are issued by the auth service.",
      "Authentication tokens expire after one hour.",
      "The auth service rotates authentication tokens daily.",
    ]) {
      await json(["remember", c, "-p", "p"]);
    }
    const scenes = await json<{ id: string; memoryIds: string[] }[]>(["scene", "list", "-p", "p"]);
    expect(scenes.length).toBe(1);
    const show = await run(["scene", "show", scenes[0]!.id, "-p", "p"]);
    expect(show.text()).toContain("memories about");
    const cons = await json<{ promoted: string[] }>(["consolidate", "--all-projects"]);
    expect(Array.isArray(cons.promoted)).toBe(true);
    const mcp = await json<{ mcpServers: Record<string, unknown> }>(["mcp"]);
    expect(mcp.mcpServers["ai-memory"]).toBeTruthy();
  });

  it("ingests Claude Code transcripts via --from-hook and Codex notify payloads", async () => {
    const transcript = join(dir, "transcript.jsonl");
    writeFileSync(
      transcript,
      [
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: "Convention: all shared models live in packages/common.",
          },
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Noted, I'll follow that." }],
          },
        }),
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", content: "ignored tool output" }],
          },
        }),
        JSON.stringify({ type: "summary", summary: "not a message" }),
      ].join("\n"),
    );
    const claude = await json<{ events: number; stored: { content: string }[] }>(
      ["ingest", "--from-hook", "--agent", "claude", "-p", "p"],
      {
        stdin: async () =>
          JSON.stringify({
            session_id: "abc",
            transcript_path: transcript,
            hook_event_name: "Stop",
          }),
      },
    );
    expect(claude.events).toBe(2);
    expect(claude.stored[0]!.content).toContain("packages/common");
    const codex = await json<{ events: number }>([
      "ingest",
      "--from-hook",
      JSON.stringify({
        type: "agent-turn-complete",
        "turn-id": "t1",
        "input-messages": ["We decided to use Bun for scripts."],
        "last-assistant-message": "Done.",
      }),
      "--agent",
      "codex",
      "-p",
      "p",
    ]);
    expect(codex.events).toBe(2);
    const events = await json<{ agent: string; sessionId: string }[]>(["events", "-p", "p"]);
    expect(new Set(events.map((e) => e.agent))).toEqual(new Set(["claude", "codex"]));
    expect(events.some((e) => e.sessionId === "abc")).toBe(true);
  });

  it("errors are structured in JSON mode", async () => {
    const r = await run(["remember", "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.errText()).error.code).toBe("INVALID_INPUT");
  });
});
