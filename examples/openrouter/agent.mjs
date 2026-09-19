// A minimal custom agent on OpenRouter (or any OpenAI-compatible chat API) with shared memory.
// Usage: OPENROUTER_API_KEY=... node agent.mjs "What database do we use for payroll?"
import { createMemory } from "@ai-memory/core";
import { buildSystemPromptWithMemory, ingestConversation } from "@ai-memory/adapter-openrouter";

const userMessage =
  process.argv.slice(2).join(" ") || "Summarise what you know about this project.";
const memory = await createMemory({
  project: process.env.AI_MEMORY_PROJECT ?? "example-openrouter",
});

const system = await buildSystemPromptWithMemory(memory, { task: userMessage, limit: 8 });
console.log("--- system prompt ---\n" + system + "\n---------------------\n");

if (!process.env.OPENROUTER_API_KEY) {
  console.log(
    "OPENROUTER_API_KEY not set; skipping the model call. The system prompt above shows the recalled memories.",
  );
  await memory.close();
  process.exit(0);
}

const res = await fetch(
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions",
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
    }),
  },
);
const json = await res.json();
const reply = json.choices?.[0]?.message?.content ?? JSON.stringify(json);
console.log(reply);

// Store the turn: raw events + conservative extraction of durable knowledge.
const r = await ingestConversation(
  memory,
  [
    { role: "user", content: userMessage },
    { role: "assistant", content: reply },
  ],
  { agent: "openrouter" },
);
console.log(`\n(ingested ${r.events.length} events, ${r.results.length} memories)`);
await memory.close();
