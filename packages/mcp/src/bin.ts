#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMemory } from "@ai-agent-memory/core";
import "@ai-agent-memory/embeddings";
import { createMcpServer } from "./server.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i !== -1) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      "Usage: ai-memory-mcp [--project <name>] [--db <path>] [--config <path>] [--cwd <dir>]\nRuns the ai-memory MCP server over stdio. Env: AI_MEMORY_PROJECT, AI_MEMORY_DB_PATH, AI_MEMORY_CONFIG.",
    );
    return;
  }
  const engine = await createMemory({
    project: arg("--project"),
    path: arg("--db"),
    configPath: arg("--config"),
    cwd: arg("--cwd") ?? process.cwd(),
  });
  const server = createMcpServer(engine);
  const transport = new StdioServerTransport();
  const shutdown = async () => {
    await server.close().catch(() => undefined);
    await engine.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await server.connect(transport);
}

main().catch((err) => {
  console.error(`ai-memory-mcp: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
