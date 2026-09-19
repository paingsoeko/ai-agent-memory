import { describe, expect, it } from "vitest";
import { codexAdapter } from "../src/index.js";

describe("codex adapter", () => {
  it("emits TOML config and notify hook", () => {
    const mcp = codexAdapter.mcpConfig({ project: "p" });
    expect(mcp.text).toContain("[mcp_servers.ai-memory]");
    expect(mcp.text).toContain('AI_MEMORY_PROJECT = "p"');
    expect(codexAdapter.hooks!()[0]!.text).toContain('notify = ["aam", "ingest", "--from-hook"');
    expect(codexAdapter.instructionsFile).toBe("AGENTS.md");
    expect(codexAdapter.bootstrapInstructions({ transport: "cli" })).toContain("aam recall");
  });
});
