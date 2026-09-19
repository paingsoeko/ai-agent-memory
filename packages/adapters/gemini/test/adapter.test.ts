import { describe, expect, it } from "vitest";
import { geminiAdapter } from "../src/index.js";

describe("gemini adapter", () => {
  it("emits settings.json config and GEMINI.md text", () => {
    const mcp = geminiAdapter.mcpConfig();
    expect(mcp.file).toBe(".gemini/settings.json");
    expect(
      (mcp.snippet as { mcpServers: Record<string, unknown> }).mcpServers["ai-memory"],
    ).toBeTruthy();
    expect(geminiAdapter.bootstrapInstructions()).toContain("Gemini CLI");
    expect(geminiAdapter.hooks!()[0]!.file).toContain("commands");
  });
});
