# Memory model

## Layers

```text
L0  Raw events        events table            provenance; immutable
L1  Atomic memories   memories (level=atomic) one reusable fact each
L2  Scenes            scenes                  named groups of related memories
L3  Core memories     memories (level=core)   stable, frequently useful knowledge
```

Plus three cross-cutting views expressed through scope and type:

- **Short-term memory** — `scope: "session"` memories. They get a default TTL (`memory.sessionTtlMs`, 7 days) and are never promoted to core.
- **Persona memory** — `type: "persona"` / `"preference"` at `user` or `global` scope ("I prefer PostgreSQL", "I write TypeScript with strict mode").
- **Project memory** — `scope: "project"` memories, including `type: "project_context"`.

### L0 — raw events

Every `ingest()` call stores the messages as events (`kind`: message, tool_result, task_summary, commit, error, decision, external, note). `remember()` accepts `sourceIds` to link manual memories to events. Events are never deleted when a derived memory is forgotten: provenance survives.

### L1 — atomic memories

```ts
interface Memory {
  id: string;
  content: string;
  type: MemoryType;          // fact | preference | decision | architecture | convention | pattern |
                             // bug_fix | lesson | task | constraint | persona | project_context | summary | custom
  level: "atomic" | "core";
  scope: "global" | "user" | "project" | "workspace" | "session";
  status: "active" | "superseded" | "conflicted" | "archived";
  projectId?: string; workspaceId?: string; sessionId?: string; userId?: string; agent?: string;
  confidence: number;        // 0..1 how sure we are the statement is true
  importance: number;        // 0..1 how much it matters
  accessCount: number; lastAccessedAt?: Date;
  createdAt: Date; updatedAt: Date; expiresAt?: Date;
  supersedes?: string; supersededBy?: string;
  sourceIds: string[];       // L0 provenance
  tags: string[]; contentHash: string; sensitive: boolean;
  metadata: { mergeCount?, aliases?, history?, ... };
}
```

### L2 — scenes

A scene groups atomic memories that belong to one topic ("Payroll Architecture", "Testing Strategy"). Scenes are created explicitly (`remember({ scene })`, `createScene`) or automatically: a new memory joins the scene it shares ≥ 2 key terms with, or spawns a new scene when ≥ 2 unclustered siblings share terms. Names and summaries are lexical and deterministic; an agent can overwrite them with `updateScene` (custom summaries are preserved by later automatic refreshes).

### L3 — core memories

Promotion is criteria-based, not automatic for everything:

| Criterion | Default |
| --- | --- |
| evidence = 1 + merges + ⌊accessCount / 3⌋ | ≥ 3 |
| importance | ≥ 0.6 |
| confidence | ≥ 0.7 |
| scope | global / user / project (never session or workspace) |
| status | active, no expiry |

A fact remembered three times ("Payroll uses Temporal", "Payroll generation uses Temporal", "Temporal is used for payroll") merges into one memory with `mergeCount = 2`, evidence 3, and is promoted. Superseded core memories are demoted during `consolidate()`.

## Scopes and isolation

```text
global ─ user ─ project ─ workspace ─ session
```

Visibility rule used by every list/search: with a `projectId`, you see that project's memories plus project-less (global/user) memories; without a project you see only global/user memories; `allProjects: true` disables isolation explicitly. Dedup and scene clustering operate inside the same visibility set, so a fact stored in project A is never merged with project B's copy.

The active project comes from (highest priority first) the API/CLI option, `AI_MEMORY_PROJECT`, `.ai-memory.json` (`"project"`), or the git root directory name (`memory.autoDetectProject`).

## Lifecycle

```text
Raw event → Extraction → Atomic memory → Deduplication → Scoring → Scene clustering → Promotion → Core memory
```

### Deduplication

1. Exact `contentHash` match (normalised: whitespace, case, trailing punctuation).
2. FTS candidates scored by Sørensen–Dice over stemmed key terms with fuzzy matching (`use`/`used`/`using`), threshold `memory.dedup.threshold` (0.75); or cosine ≥ `semanticThreshold` (0.92) when embeddings exist.
3. Merge: union of sources and tags, `confidence = min(1, max + 0.05)`, `importance = max`, alternate phrasings kept in `metadata.aliases`, history entry `merged`.

### Conflict detection

Statements are parsed into subject / predicate / object (`X uses Y`, `X = Y`, `X is Y`, `X runs on Y`, ...). Same subject and predicate with a disjoint object, or a negated restatement, is a conflict.

| policy | effect |
| --- | --- |
| `supersede` (default) | old → `status: superseded`, `supersededBy: new`; new → `supersedes: old` |
| `flag` | both → `status: conflicted`, linked via `metadata.conflictsWith`; resolve with `resolveConflict(winnerId, loserId)` |
| `ignore` | insert independently |

Nothing is overwritten. Superseded memories are hidden from default search but remain in `list({ status: "superseded" })` and `inspect`.

### Expiration

`expiresAt` / `ttlMs` hide a memory from search once passed; `consolidate()` archives expired memories.

### Provenance

`inspect(id)` returns the memory, its raw events, scenes, `supersedes` / `supersededBy` memories, related memories and the lifecycle history stored in `metadata.history` (`created`, `merged`, `updated`, `promoted`, `demoted`, `superseded`, `conflicted`, `archived`).
