# MCP server

`@ai-memory/mcp` exposes the local memory store to any MCP-capable agent over stdio. It has no cloud dependency: the server process opens the same SQLite file the CLI uses.

```bash
npx -y @ai-memory/mcp                       # or after global install: ai-memory-mcp
ai-memory-mcp --project my-app --db ~/.ai-memory/memory.db
```

Environment: `AI_MEMORY_PROJECT`, `AI_MEMORY_DB_PATH`, `AI_MEMORY_CONFIG`, plus everything in [configuration](configuration.md). When launched from a project directory the active project is detected from `.ai-memory.json` or the git root name.

## Tools

| Tool | Purpose | Key arguments |
| --- | --- | --- |
| `memory_recall` | Ranked memories for a task; records access; includes core memories | `query`, `project?`, `limit?`, `type?`, `includeCore?`, `format?` |
| `memory_search` | Pure relevance search | `query`, `project?`, `limit?`, `type?`, `mode?`, `allProjects?` |
| `memory_remember` | Store durable knowledge (dedup + conflict handling) | `content`, `type?`, `project?`, `scope?`, `importance?`, `confidence?`, `tags?`, `scene?`, `ttlMs?`, `sensitive?`, `sourceIds?`, `force?` |
| `memory_update` | Patch a memory | `id`, `content?`, `type?`, `importance?`, `confidence?`, `tags?`, `status?`, `level?`, `expiresAt?` |
| `memory_forget` | Delete (or `archive: true`) | `id`, `archive?` |
| `memory_inspect` | Provenance, scenes, supersedes links, related, history | `id` |
| `memory_list` | Filtered, paginated listing | `project?`, `type?`, `scope?`, `level?`, `status?`, `tags?`, `limit?`, `offset?`, `orderBy?` |
| `memory_ingest` | Automatic mode: store raw messages, extract durable knowledge | `messages[]`, `project?`, `sessionId?`, `agent?`, `rawOnly?` |
| `memory_status` | Stats, active project and privacy posture | — |

Every tool returns both a human-readable `content[0].text` (markdown for recall/search/list) and `structuredContent` (JSON). Ids accept unique prefixes.

Example call:

```json
{ "name": "memory_search", "arguments": { "query": "Temporal trace propagation", "project": "my-app" } }
```

## Server instructions

The server advertises `instructions` telling the agent to recall at task start, remember only durable knowledge, and rely on superseding for corrections. Adapter packages provide equivalent text for CLAUDE.md / AGENTS.md / GEMINI.md.

## Programmatic use

```ts
import { createMemory } from "@ai-memory/core";
import { createMcpServer } from "@ai-memory/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const engine = await createMemory();
const server = createMcpServer(engine);
await server.connect(new StdioServerTransport());
```

Tests use `InMemoryTransport.createLinkedPair()` from the MCP SDK to exercise every tool without spawning a process (`packages/mcp/test`).
