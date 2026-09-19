# @local-ai-agent-memory/core

Local-first, agent-agnostic memory engine for AI coding agents. SQLite + FTS5 (via Node's built-in `node:sqlite`, zero runtime dependencies), optional embeddings, layered memory (raw events → atomic → scenes → core), deduplication, conflict superseding, provenance.

```ts
import { createMemory } from "@local-ai-agent-memory/core";

const memory = await createMemory({ project: "my-project" });
await memory.remember({ content: "Use PostgreSQL JSONB for policy metadata.", type: "architecture", importance: 0.9 });
const results = await memory.recall({ query: "policy database design", limit: 10 });
await memory.inspect(results[0].memory.id);
```

Requires Node.js ≥ 22.13. Full documentation: https://github.com/paingsoeko/ai-agent-memory
