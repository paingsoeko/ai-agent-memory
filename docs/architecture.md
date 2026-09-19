# Architecture

ai-memory is a small, layered system. The engine knows nothing about any AI vendor or agent; agents talk to it through three equivalent doors (TypeScript API, CLI with `--json`, MCP server) and all doors open onto the same SQLite file.

```text
┌───────────────┐  ┌───────────────┐  ┌────────────────┐  ┌───────────────┐
│ Claude Code   │  │ Codex         │  │ Gemini / Open- │  │ Custom agent  │
│ (MCP + hooks) │  │ (MCP + notify)│  │ Code (MCP)     │  │ (API / CLI)   │
└──────┬────────┘  └──────┬────────┘  └───────┬────────┘  └──────┬────────┘
       │  adapters: bootstrap text, hooks, config snippets, formatting only
┌──────▼──────────────────▼────────────────────▼──────────────────▼────────┐
│  @local-ai-agent-memory/mcp            @local-ai-agent-memory/cli              TypeScript API     │
└──────────────────────────────────┬────────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼────────────────────────────────────────┐
│ @local-ai-agent-memory/core  MemoryEngine                                             │
│   remember · recall · search · inspect · update · forget · ingest         │
│   lifecycle: dedup → conflict → scoring → scenes → promotion              │
│   search: FTS5 ∪ vectors → RRF → rerank                                   │
│   config · privacy · export/import                                        │
├───────────────────────────────────────────────────────────────────────────┤
│ MemoryStore (interface)          EmbeddingProvider (interface, optional)  │
│   SQLiteStore (node:sqlite)        hash (built-in) · ollama · openai ·    │
│   PostgresStore (future)           openrouter · transformers.js (opt-in)  │
└───────────────────────────────────────────────────────────────────────────┘
                                   │
                        ~/.ai-memory/memory.db (SQLite + FTS5 + WAL)
```

## Package boundaries

| Package | Depends on | Responsibility |
| --- | --- | --- |
| `@local-ai-agent-memory/core` | nothing (Node ≥ 22.13) | Domain types, `MemoryStore` contract, default SQLite store, engine, search, lifecycle, heuristic extractor, config loading, built-in local hashing embeddings, prompt formatting, adapter contract |
| `@local-ai-agent-memory/embeddings` | core | Network / neural embedding providers; registers them by name on import |
| `@local-ai-agent-memory/cli` | core, embeddings | `ai-memory` binary. Pure function `runCli(argv, io)` so it is testable in-process |
| `@local-ai-agent-memory/mcp` | core, embeddings, `@modelcontextprotocol/sdk` | `createMcpServer(engine)` + `ai-memory-mcp` stdio binary |
| `@local-ai-agent-memory/adapter-*` | core | Instruction text, MCP config snippets, hook definitions, context formatting for one agent. **No storage logic.** |

Why the SQLite store lives in core rather than a separate `storage-sqlite` package: `npm install @local-ai-agent-memory/core` must work with zero configuration, and a separate default-store package would create a dependency cycle (core needs the store to have a default; the store needs core's types). The `MemoryStore` interface is nevertheless the only thing the engine uses, so alternative stores (`PostgresStore`, an encrypted store) are separate packages that implement it and are passed via `createMemory({ store })`.

## Data model

Tables (see `packages/core/src/storage/sqlite/schema.ts`):

| Table | Layer | Notes |
| --- | --- | --- |
| `events` | L0 | Raw messages, tool results, commits, errors, decisions. Never rewritten. |
| `memories` | L1/L3 | Atomic (`level = atomic`) and core (`level = core`) memories. Indexed on project, type, scope, status, level, created/updated, importance, hash, expiry. |
| `memories_fts` | | FTS5 external-content table (porter + unicode61 tokenizer) kept in sync by triggers. |
| `memory_sources` | provenance | memory ↔ event links. |
| `scenes`, `scene_memories` | L2 | Named groups of related memories with keywords and a summary. |
| `memory_embeddings` | | One vector per (memory, model). Stored as Float32 blobs; switching models is safe. |
| `projects`, `sessions` | | Metadata. |
| `meta` | | Schema version. |

## Request flow: `remember`

1. Normalise content, resolve project & scope (project scope falls back to user scope when there is no project), compute expiry (session memories get a default TTL), detect secrets → `sensitive`.
2. Embed the content if a provider is configured (skipped for sensitive content with network providers).
3. **Dedup**: exact hash → normalised match → FTS candidates scored with fuzzy Dice similarity (and cosine when embeddings exist). ≥ threshold → merge into the existing memory (sources, aliases, confidence bump, history entry).
4. **Conflict**: candidates that share subject + predicate but differ in object (`Database = MySQL` vs `Database = PostgreSQL`), or negate each other, trigger the conflict policy: `supersede` (default), `flag`, or `ignore`.
5. Insert, attach to a scene (explicit or automatic clustering), evaluate promotion.

## Request flow: `recall`

1. Keyword search (FTS5, bm25) and, when enabled, vector search over the filtered candidate set.
2. Reciprocal Rank Fusion.
3. Rerank with importance, confidence, recency, access frequency, project match and level.
4. Optionally append top core memories; record access for the returned page.

## Performance

- All list/search operations are paginated; the vector scan streams embeddings in 1,000-row chunks keyed by rowid and keeps only the top-k, so a 100k-memory database is never loaded whole.
- Writes are batched in transactions (`createEvents`, `setEmbeddings`); statements are prepared per call.
- WAL mode is enabled for file databases so multiple agent processes can read while one writes.
- Embedding backfill (`embedPending`) works in batches sized by `embeddings.batchSize`.

Measured on an Apple Silicon laptop with the built packages (`node:sqlite`, SQLite 3.51), 100,000 memories across 20 projects and 1,000,000 raw events in one 486 MB file:

| Operation | Time |
| --- | --- |
| Insert 100k memories (batches of 5k) | 11.1 s |
| Insert 1M events (batches of 20k) | 14.9 s |
| FTS keyword search, project filter | 13 ms |
| FTS keyword search, all projects | 22 ms |
| Paginated list at offset 20k | 15 ms |
| Embed + store 100k hash vectors | 3.8 s |
| Vector scan over 100k (top 50) | 201 ms |
| `remember()` (dedup + conflict + scene + embed) | 51 ms |
| `recall()` hybrid | 115 ms |
| Process RSS after all of the above | 273 MB |

The keyword query uses `CROSS JOIN` to pin the FTS5 scan as the outer loop; without it SQLite may iterate `memories` and re-run the MATCH per row (the same search took 117 s). A regression test in `packages/core/test/storage.test.ts` guards this.

## Extending

- **Another store**: implement `MemoryStore` (see `packages/core/src/storage/store.ts`) and pass it to `createMemory({ store })`.
- **Another embedding provider**: implement `EmbeddingProvider` and either pass the instance to `createMemory({ embeddings })` or `registerEmbeddingProvider("name", factory)`.
- **A smarter extractor**: pass `extractor` to `createMemory` or per call to `ingest`. This is where an agent can plug in its own LLM without coupling the core to a vendor.
- **Another agent**: implement `AgentAdapter` (bootstrap text, config snippet, hooks, formatting). No storage code needed.
