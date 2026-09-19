/**
 * Verifies the core promise: two different agents (here an MCP client acting as
 * "Claude" and the CLI acting as "Codex") read and write the exact same local
 * database, and each sees the other's memories with full provenance.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMemory } from "@local-ai-agent-memory/core";
import { runCli, type CliIO } from "@local-ai-agent-memory/cli";
import { createMcpServer } from "@local-ai-agent-memory/mcp";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("one local memory, many agents", () => {
  it("MCP (claude) and CLI (codex) share the same SQLite file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aim-shared-"));
    const db = join(dir, "memory.db");

    // Agent 1: "Claude" over MCP.
    const engine = await createMemory({ path: db, skipConfigFiles: true, project: "my-app" });
    const server = createMcpServer(engine);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const claude = new Client({ name: "claude", version: "1" });
    await claude.connect(ct);
    const remembered = (await claude.callTool({
      name: "memory_remember",
      arguments: {
        content: "Payroll generation uses Temporal workflows.",
        type: "architecture",
        agent: "claude",
      },
    })) as unknown as { structuredContent: { memory: { id: string } } };
    const id = remembered.structuredContent.memory.id;

    // Agent 2: "Codex" via the CLI, same database, different process boundary simulated by a fresh engine.
    const out: string[] = [];
    const io: CliIO = {
      stdout: (t) => out.push(t),
      stderr: (t) => out.push(t),
      cwd: dir,
      env: { AI_MEMORY_DB_PATH: db, XDG_CONFIG_HOME: join(dir, "cfg"), HOME: dir },
    };
    expect(
      await runCli(["recall", "how does payroll generation work?", "-p", "my-app", "--json"], io),
    ).toBe(0);
    const recalled = JSON.parse(out.join("\n")) as { id: string; memory: { agent: string } }[];
    expect(recalled[0]!.id).toBe(id);
    expect(recalled[0]!.memory.agent).toBe("claude");

    out.length = 0;
    expect(
      await runCli(
        [
          "remember",
          "All distributed tracing uses W3C traceparent.",
          "-t",
          "convention",
          "-p",
          "my-app",
          "--agent",
          "codex",
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    const codexMemory = JSON.parse(out.join("\n")) as { memory: { id: string } };

    // Claude sees Codex's memory immediately (WAL, same file), with provenance.
    const seen = (await claude.callTool({
      name: "memory_search",
      arguments: { query: "traceparent tracing", project: "my-app" },
    })) as unknown as {
      structuredContent: { items: { id: string }[] };
    };
    expect(seen.structuredContent.items[0]!.id).toBe(codexMemory.memory.id);
    const insp = (await claude.callTool({
      name: "memory_inspect",
      arguments: { id: codexMemory.memory.id },
    })) as unknown as { structuredContent: { memory: { agent: string } } };
    expect(insp.structuredContent.memory.agent).toBe("codex");

    // Access recorded by Codex's recall is visible to Claude.
    const status = (await claude.callTool({ name: "memory_status", arguments: {} })) as unknown as {
      structuredContent: { memories: number };
    };
    expect(status.structuredContent.memories).toBe(2);

    await claude.close();
    await engine.close();
  });

  it("project isolation holds across agents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aim-iso-"));
    const db = join(dir, "memory.db");
    const a = await createMemory({ path: db, skipConfigFiles: true, project: "project-a" });
    await a.remember({ content: "Project A secret architecture.", agent: "gemini" });
    await a.close();
    const b = await createMemory({ path: db, skipConfigFiles: true, project: "project-b" });
    expect(await b.search({ query: "architecture" })).toHaveLength(0);
    expect(await b.count({ allProjects: true })).toBe(1);
    await b.close();
  });
});
