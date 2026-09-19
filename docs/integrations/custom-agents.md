# Custom agents

Three equivalent ways to use the shared memory:

1. **TypeScript API** — `import { createMemory } from "@local-ai-agent-memory/core"` (see [api.md](../api.md)).
2. **CLI with `--json`** — any language: `aam recall "..." --json`, `aam remember "..." --json`, `echo '[{"role":"user","content":"..."}]' | aam ingest --json`.
3. **MCP** — run `ai-memory-mcp` over stdio from any MCP client (see [mcp.md](../mcp.md)).

Recommended loop for an agent:

```text
task starts   → recall(query = task description, includeCore = true) → put results in context
during task   → remember() only for durable decisions/preferences/architecture/conventions/lessons
task ends     → ingest(messages) so raw events are kept and durable knowledge is extracted
```

To bring your own LLM-based extraction while keeping the engine vendor-neutral, pass an `extractor`:

```ts
await memory.ingest({
  messages,
  extractor: async (msgs) => callMyLlm(msgs).then(facts => facts.map(f => ({ ...f, messageIndex: 0, reason: "llm" }))),
});
```

Implement `AgentAdapter` (from core) if you want to ship bootstrap text and config snippets for a new agent; adapters must not store memory themselves.
