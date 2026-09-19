import { describe, expect, it } from "vitest";
import { opencodeAdapter } from "../src/index.js";

describe("opencode adapter", () => {
  it("emits opencode.json config and a plugin", () => {
    const mcp = opencodeAdapter.mcpConfig({ project: "p" });
    expect(
      (
        mcp.snippet as {
          mcp: { "ai-memory": { command: string[]; environment: { AI_MEMORY_PROJECT: string } } };
        }
      ).mcp["ai-memory"].command,
    ).toEqual(["npx", "-y", "@ai-memory/mcp"]);
    expect(opencodeAdapter.hooks!({ project: "p" })[0]!.text).toContain("session.idle");
    expect(opencodeAdapter.bootstrapInstructions()).toContain("OpenCode");
  });
});
