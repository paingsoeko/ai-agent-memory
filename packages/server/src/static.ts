import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate the bundled web UI (`@ai-agent-memory/web` dist directory).
 *
 * Layouts handled:
 * - monorepo dev:      packages/server/dist -> ../../web/dist
 * - npm global install: node_modules/@ai-agent-memory/server/dist -> ../../web/dist
 *   (i.e. node_modules/@ai-agent-memory/web/dist, installed as a dependency)
 *
 * Returns the directory when it contains a built `index.html`, else null.
 */
export function defaultStaticDir(fromUrl: string = import.meta.url): string | null {
  const dir = join(dirname(fileURLToPath(fromUrl)), "..", "..", "web", "dist");
  return existsSync(join(dir, "index.html")) ? dir : null;
}
