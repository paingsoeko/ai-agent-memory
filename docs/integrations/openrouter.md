# OpenRouter and custom LLM agents

There is no OpenRouter *agent* to configure; OpenRouter is an API. `@local-ai-agent-memory/adapter-openrouter` provides helpers for agents you write yourself against OpenRouter (or any OpenAI-compatible chat API):

```ts
import { createMemory } from "@local-ai-agent-memory/core";
import { buildSystemPromptWithMemory, ingestConversation } from "@local-ai-agent-memory/adapter-openrouter";

const memory = await createMemory({ project: "my-app" });
const system = await buildSystemPromptWithMemory(memory, { task: userMessage });

const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
  body: JSON.stringify({ model: "anthropic/claude-sonnet-4", messages: [{ role: "system", content: system }, { role: "user", content: userMessage }] }),
});
const reply = (await res.json()).choices[0].message.content;

await ingestConversation(memory, [{ role: "user", content: userMessage }, { role: "assistant", content: reply }], { agent: "openrouter" });
```

## OpenRouter embeddings (optional, network)

```json
{
  "embeddings": { "provider": "openrouter", "model": "openai/text-embedding-3-small" },
  "privacy": { "allowNetworkEmbeddings": true }
}
```

Requires `OPENROUTER_API_KEY`. Memory text is sent to OpenRouter for embedding only; sensitive memories are never sent. See `examples/openrouter/`.
