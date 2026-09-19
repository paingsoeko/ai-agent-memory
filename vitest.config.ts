import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@ai-memory/core": r("./packages/core/src/index.ts"),
      "@ai-memory/embeddings": r("./packages/embeddings/src/index.ts"),
      "@ai-memory/cli": r("./packages/cli/src/index.ts"),
      "@ai-memory/mcp": r("./packages/mcp/src/index.ts"),
      "@ai-memory/adapter-claude": r("./packages/adapters/claude/src/index.ts"),
      "@ai-memory/adapter-codex": r("./packages/adapters/codex/src/index.ts"),
      "@ai-memory/adapter-gemini": r("./packages/adapters/gemini/src/index.ts"),
      "@ai-memory/adapter-opencode": r("./packages/adapters/opencode/src/index.ts"),
      "@ai-memory/adapter-openrouter": r("./packages/adapters/openrouter/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/test/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
