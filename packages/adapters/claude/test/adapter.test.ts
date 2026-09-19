import { describe, expect, it } from "vitest";
import { claudeAdapter } from "../src/index.js";

describe("claude adapter", () => {
  it("produces bootstrap text, mcp config and hooks", () => {
    expect(claudeAdapter.bootstrapInstructions({ project: "p" })).toContain("memory_recall");
    const mcp = claudeAdapter.mcpConfig({ project: "p" });
    expect(mcp.file).toBe(".mcp.json");
    expect(
      (mcp.snippet as { mcpServers: { "ai-memory": { env: { AI_MEMORY_PROJECT: string } } } })
        .mcpServers["ai-memory"].env.AI_MEMORY_PROJECT,
    ).toBe("p");
    expect(mcp.text).toContain("claude mcp add ai-memory");
    const hooks = claudeAdapter.hooks!();
    expect(hooks[0]!.text).toContain("SessionStart");
    expect(hooks[0]!.text).toContain("ingest --from-hook");
    expect(claudeAdapter.formatContext([])).toContain("(none)");
  });
});
