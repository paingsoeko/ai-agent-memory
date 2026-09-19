import { createMemory } from "@ai-agent-memory/core";
import { describe, expect, it } from "vitest";
import {
  buildSystemPromptWithMemory,
  ingestConversation,
  openrouterAdapter,
} from "../src/index.js";

describe("openrouter adapter", () => {
  it("builds prompts with memory and ingests conversations", async () => {
    const engine = await createMemory({ path: ":memory:", skipConfigFiles: true, project: "p" });
    await ingestConversation(engine, [
      { role: "system", content: "ignored" },
      { role: "user", content: "We decided to use Temporal for payroll generation." },
      { role: "assistant", content: [{ type: "text", text: "Great." }] },
    ]);
    const prompt = await buildSystemPromptWithMemory(engine, { task: "payroll generation" });
    expect(prompt).toContain("Temporal");
    expect(prompt).toContain("## Memory (ai-memory)");
    expect(openrouterAdapter.mcpConfig().text).toContain("openrouter");
    await engine.close();
  });
});
