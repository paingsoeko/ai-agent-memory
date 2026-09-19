#!/usr/bin/env node
/**
 * Clean-environment smoke test for the built CLI and MCP binaries.
 * Uses a temporary HOME so no user data is touched. Run after `pnpm build`.
 */
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const cli = join(root, "packages/cli/dist/bin.js");
const mcp = join(root, "packages/mcp/dist/bin.js");
const home = mkdtempSync(join(tmpdir(), "ai-memory-smoke-"));
const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  AI_MEMORY_DB_PATH: join(home, "memory.db"),
};

function run(args, input) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    env,
    cwd: home,
    input,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(`FAILED: aam ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  return r.stdout;
}

console.log("→ init");
console.log(run(["init"]).trim());
run(["remember", "I prefer PostgreSQL for backend projects.", "-t", "preference"]);
run(["remember", "Payroll uses Temporal.", "-p", "demo"]);
run(["remember", "Payroll generation uses Temporal.", "-p", "demo"]);
const recall = JSON.parse(run(["recall", "database preference", "--json"]));
if (!recall[0] || !recall[0].memory.content.includes("PostgreSQL"))
  throw new Error("recall failed");
const demo = JSON.parse(run(["list", "-p", "demo", "--scope", "project", "--json"]));
if (demo.length !== 1) throw new Error(`dedup failed, expected 1 memory got ${demo.length}`);
console.log("→ inspect");
console.log(run(["inspect", demo[0].id, "-p", "demo"]).split("\n").slice(0, 6).join("\n"));
run(["export", join(home, "export.json")]);
run(["import", join(home, "export.json")]);
console.log("→ privacy");
console.log(run(["privacy"]).trim());

// MCP server over stdio: initialize + list tools + call memory_recall.
console.log("→ mcp stdio");
const proc = spawn(process.execPath, [mcp, "--project", "demo"], { env, cwd: home });
let buffer = "";
const pending = new Map();
proc.stdout.on("data", (d) => {
  buffer += d.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) pending.get(msg.id)(msg);
  }
});
proc.stderr.on("data", (d) => process.stderr.write(d));
const send = (id, method, params) =>
  new Promise((res) => {
    pending.set(id, res);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
const init = await send(1, "initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
if (!init.result?.serverInfo?.name) throw new Error("mcp init failed");
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const tools = await send(2, "tools/list", {});
const names = tools.result.tools.map((t) => t.name);
for (const n of [
  "memory_search",
  "memory_recall",
  "memory_remember",
  "memory_update",
  "memory_forget",
  "memory_inspect",
  "memory_list",
]) {
  if (!names.includes(n)) throw new Error(`missing tool ${n}`);
}
const rc = await send(3, "tools/call", { name: "memory_recall", arguments: { query: "payroll" } });
if (!rc.result.content[0].text.includes("Temporal"))
  throw new Error("mcp recall failed: " + JSON.stringify(rc));
console.log(rc.result.content[0].text);
// Wait for the server to exit before cleaning up: on Windows the SQLite file stays locked until then.
await new Promise((res) => {
  proc.once("exit", res);
  proc.kill("SIGTERM");
  setTimeout(() => proc.kill("SIGKILL"), 3000).unref();
});
try {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch (err) {
  console.warn(`(cleanup skipped: ${err.code ?? err.message})`);
}
console.log("\n✓ smoke test passed");
