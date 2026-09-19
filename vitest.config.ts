import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@local-ai-agent-memory/core": r("./packages/core/src/index.ts"),
      "@local-ai-agent-memory/embeddings": r("./packages/embeddings/src/index.ts"),
      "@local-ai-agent-memory/cli": r("./packages/cli/src/index.ts"),
      "@local-ai-agent-memory/mcp": r("./packages/mcp/src/index.ts"),
      "@local-ai-agent-memory/adapter-claude": r("./packages/adapters/claude/src/index.ts"),
      "@local-ai-agent-memory/adapter-codex": r("./packages/adapters/codex/src/index.ts"),
      "@local-ai-agent-memory/adapter-gemini": r("./packages/adapters/gemini/src/index.ts"),
      "@local-ai-agent-memory/adapter-opencode": r("./packages/adapters/opencode/src/index.ts"),
      "@local-ai-agent-memory/adapter-openrouter": r("./packages/adapters/openrouter/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/test/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
