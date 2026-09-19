// Shared helpers for release scripts. Publishable packages in dependency order.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Topological order: dependencies first. */
export const PACKAGE_DIRS = [
  "packages/core",
  "packages/embeddings",
  "packages/server",
  "packages/cli",
  "packages/mcp",
  "packages/adapters/claude",
  "packages/adapters/codex",
  "packages/adapters/gemini",
  "packages/adapters/opencode",
  "packages/adapters/openrouter",
];

export function readManifest(dir) {
  const path = join(ROOT, dir, "package.json");
  return { path, dir, manifest: JSON.parse(readFileSync(path, "utf8")) };
}

export function publishablePackages() {
  return PACKAGE_DIRS.map(readManifest).filter((p) => !p.manifest.private);
}

export function normalizeVersion(tagOrVersion) {
  return String(tagOrVersion).trim().replace(/^v/, "");
}

export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
