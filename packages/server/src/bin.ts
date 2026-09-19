#!/usr/bin/env node
import { defaultStaticDir, startServer } from "./index.js";

const args = process.argv.slice(2);
const get = (flag: string, fallback?: string) => {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  return fallback;
};

const port = Number(get("--port", process.env.AI_MEMORY_PORT ?? "4123"));
const host = get("--host", process.env.AI_MEMORY_HOST ?? "127.0.0.1")!;
const db = get("--db", process.env.AI_MEMORY_DB_PATH);
const project = get("--project", process.env.AI_MEMORY_PROJECT);
// Prefer the bundled web UI (@ai-agent-memory/web dist) when present.
const staticDir = get("--static", process.env.AI_MEMORY_STATIC) ?? defaultStaticDir() ?? undefined;

await startServer({
  port: Number.isFinite(port) ? port : 4123,
  host,
  staticDir,
  ...(db ? { path: db } : {}),
  ...(project ? { project } : {}),
});
