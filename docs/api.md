# API reference (`@ai-memory/core`)

## `createMemory(options?) → Promise<MemoryEngine>`

```ts
const memory = await createMemory({
  project: "my-project",          // active project (else .ai-memory.json / git root)
  path: "~/.ai-memory/memory.db", // or ":memory:"
  embeddings: { provider: "hash" } // | "none" | "local" | "ollama" | "openai" | EmbeddingProvider instance
  memory: { conflicts: { policy: "flag" } }, // any config override
  store: customStore,              // any MemoryStore implementation
  extractor: myExtractor,          // custom ingest extractor
  cwd, configPath, env, skipConfigFiles,
});
```

## MemoryEngine

### Writing

| Method | Returns | Notes |
| --- | --- | --- |
| `remember(input)` | `RememberResult { memory, action, relatedId?, similarity? }` | `action` ∈ created, merged, superseded, conflicted |
| `update(id, patch)` | `Memory` | Accepts id prefixes. Re-embeds when content changes |
| `forget(id, { archive? })` | `{ id, archived }` | Hard delete by default; raw events are kept |
| `promote(id)` / `demote(id)` | `Memory` | Move between atomic and core |
| `supersede(oldId, newId)` / `resolveConflict(winnerId, loserId)` | `{ old, fresh }` | |
| `addEvent(input)` | `RawEvent` | Store an L0 event |
| `ingest(input)` | `IngestResult { events, candidates, results, skipped }` | Automatic mode |
| `import(data, { overwrite?, includeEmbeddings? })` | `ImportResult` | |

`RememberInput`: `content`, `type?`, `scope?`, `projectId?`/`project?`, `workspaceId?`, `sessionId?`, `userId?`, `agent?`, `confidence?`, `importance?`, `tags?`, `sourceIds?`, `expiresAt?`/`ttlMs?`, `sensitive?`, `metadata?`, `scene?`, `force?`.

### Reading

| Method | Returns |
| --- | --- |
| `recall({ query, projectId?, limit?, type?, includeCore?, trackAccess?, mode?, ... })` | `MemoryResult[]` — ranked with boosts, access recorded |
| `search({ query, ... })` | `MemoryResult[]` — pure relevance |
| `get(id)` | `Memory` |
| `inspect(id)` | `MemoryInspection { memory, sources, scenes, supersedes, supersededBy, related, history }` |
| `list({ projectId?, type?, scope?, level?, status?, tags?, limit?, offset?, orderBy?, order?, allProjects?, includeExpired? })` | `Memory[]` |
| `count(filter)` | `number` |
| `listEvents(filter)` / `getEvent(id)` | `RawEvent[]` / `RawEvent \| null` |
| `listScenes()` / `getScene(id)` / `createScene()` / `updateScene()` / `addToScene()` / `removeFromScene()` / `deleteScene()` | scenes (L2) |
| `createProject(name)` / `listProjects()` / `getProject(name)` | projects |
| `export({ includeEmbeddings? })` | `ExportData` (JSON-serialisable) |
| `stats()` | `MemoryStats` |
| `privacy()` | `PrivacyInfo` |

### Maintenance

| Method | Purpose |
| --- | --- |
| `consolidate({ projectId?, allProjects? })` | Archive expired, promote/demote, cluster scenes, backfill embeddings |
| `embedPending(limit?)` | Backfill embeddings in batches |
| `close()` | Close the store |

`MemoryResult`:

```ts
interface MemoryResult {
  memory: Memory;
  score: number;
  source: "keyword" | "semantic" | "hybrid";
  explanation?: string;
}
```

## Interfaces for extension

```ts
interface MemoryStore { /* see packages/core/src/storage/store.ts */ }

interface EmbeddingProvider {
  name: string; model: string; dimensions?: number; requiresNetwork: boolean;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
registerEmbeddingProvider("my-provider", (config) => new MyProvider(config));

type MemoryExtractor = (messages: IngestMessage[], ctx) => ExtractedCandidate[] | Promise<ExtractedCandidate[]>;

interface AgentAdapter { name; displayName; instructionsFile; bootstrapInstructions(); mcpConfig(); hooks?(); formatContext(); }
```

## Helpers

- `formatMemoriesForPrompt(results, { maxChars, header, includeIds, includeScores })` — compact markdown for system prompts.
- `buildBootstrapInstructions(agentName, { project, transport })` — agent-agnostic instruction text.
- `createHeuristicExtractor(options)` — the default conservative extractor.
- `looksLikeSecret(text)`, `contentHash`, `diceSimilarity`, `keyTerms`, `reciprocalRankFusion`, `rankCandidates`, `evaluatePromotion`, `parseStatement`, `statementsConflict`.
- Errors: `MemoryError { code, hint }`, `NotFoundError`, `InvalidInputError`. Codes: `NOT_FOUND`, `INVALID_INPUT`, `CONFIG`, `STORAGE`, `EMBEDDINGS`, `AMBIGUOUS`, `UNSUPPORTED`.
