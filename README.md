# ai-memory

**A local-first, agent-agnostic memory layer for AI coding agents.**

Give Claude Code, Codex, Gemini CLI, OpenCode and your own agents one shared, long-term memory that lives on your machine.

```text
Claude Code ─┐
Codex ───────┤
Gemini CLI ──┼──→  ai-memory  ──→  ~/.ai-memory/memory.db  (SQLite, FTS5, optional embeddings)
OpenCode ────┤
Your agent ──┘
```

A fact remembered by one agent is recalled by all the others.

## Why ai-memory

- **Local-first.** One SQLite file. No cloud, no account, no API key, no telemetry.
- **Agent-agnostic.** The engine has no vendor-specific code. Agents connect over [MCP](docs/mcp.md), the CLI, or the TypeScript API.
- **Per-project isolation.** Memories belong to a project by default. Personal preferences can be global.
- **Conservative.** Duplicates are merged, conflicting facts are superseded rather than overwritten, and automatic ingestion prefers to store nothing over storing noise.
- **Traceable.** Every memory keeps its provenance: which conversation it came from, what it replaced, and its full history.
- **No runtime dependencies.** The core uses Node's built-in `node:sqlite`.

Requires Node.js 22.13 or newer.

## Quick start

```bash
npm install -g @ai-agent-memory/cli   # installs the `aam` command
aam init                              # creates ~/.ai-memory/memory.db
aam remember "I prefer PostgreSQL for backend projects."
aam recall "database preference"
```

```text
0.734  3f9c1a2e  [preference | user]  I prefer PostgreSQL for backend projects.
```

Then connect an agent (see [Connect your agents](#connect-your-agents)).

## Core concepts

**Memory layers.** Knowledge moves up through four layers, and every step keeps a link back to where it came from.

| Layer | Name | What it holds |
| --- | --- | --- |
| L0 | Raw events | Conversation messages as they happened |
| L1 | Atomic memories | Single facts, preferences, decisions |
| L2 | Scenes | Groups of related memories on one topic |
| L3 | Core memories | The most important, frequently used knowledge |

**Scopes.** Memories are stored at a scope: `global`, `user`, `project`, `workspace` or `session`. Recall prefers the current project and never leaks another project's memories unless you ask for all projects.

**Types.** Each memory has a type that helps ranking and filtering: `fact` (default), `preference`, `decision`, `architecture`, `convention`, `pattern`, `bug_fix`, `lesson`, `task`, `constraint`, `persona`, `project_context`, `summary`, or any custom string.

**Conflicts.** Remembering "Database = PostgreSQL" after "Database = MySQL" marks the old memory as superseded. Both stay inspectable.

More detail: [Memory model](docs/memory-model.md) · [Retrieval](docs/retrieval.md) · [Architecture](docs/architecture.md)

## Using the CLI

### Projects

Inside a repository, memories are scoped to that project automatically (by git root folder name). To name it explicitly:

```bash
cd ~/code/my-app
aam project use my-app     # writes .ai-memory.json in this directory
aam project current        # -> my-app
```

Use `--global` for things that apply everywhere, such as personal preferences.

### Remember

```bash
aam remember "Data processing uses Temporal workflows." -t architecture --importance 0.9
aam remember "Always run pnpm lint before committing." -t convention
aam remember "I prefer PostgreSQL for backend projects." -t preference --global
```

Useful flags: `--tags a,b`, `--scene "Payroll"`, `--ttl 7d` (short-term), `--sensitive` (never sent to a network embedding provider), `--force` (skip deduplication).

### Recall and search

```bash
aam recall "how does data processing work?"   # ranked for a task, records access
aam recall "payroll" --core --verbose         # include core memories, explain ranking
aam search "trace propagation" -t architecture   # pure relevance, no side effects
aam list --level core                         # everything promoted to core
aam list --status superseded                  # history of replaced facts
```

Ranking combines relevance, importance, confidence, recency, access frequency and project match.

### Inspect, edit, forget

```bash
aam inspect 3f9c1a2e     # provenance, scenes, supersedes links, history
aam update 3f9c1a2e --importance 0.95 --tags db,infra
aam promote 3f9c1a2e     # force to core (L3)
aam forget 3f9c1a2e      # delete (raw events kept); --archive hides instead
aam scene list           # topic groups (L2)
```

IDs can be shortened to any unique prefix.

### Maintenance

```bash
aam consolidate          # expire, promote/demote, cluster scenes, backfill embeddings
aam export ./memory.json # portable backup (--embeddings to include vectors)
aam import ./memory.json # merge into another machine's database
aam status               # database stats, active project, config sources
aam privacy              # what is stored where, and what leaves the machine (nothing by default)
```

### Scripting

Every command accepts `--json` and prints stable JSON on stdout. Errors go to stderr. Exit codes: `1` error, `2` usage, `3` not found.

```bash
aam recall "Temporal" --json | jq '.[0].memory.content'
```

Full reference: [docs/cli.md](docs/cli.md)

## Connect your agents

All agents talk to the same database through the MCP server.

```bash
claude mcp add ai-memory -- npx -y @ai-agent-memory/mcp   # Claude Code
codex mcp add ai-memory -- npx -y @ai-agent-memory/mcp    # Codex
aam mcp                                                   # snippets for Gemini CLI, OpenCode, generic JSON
```

The server exposes `memory_recall`, `memory_remember`, `memory_search`, `memory_update`, `memory_forget`, `memory_inspect`, `memory_list`, `memory_ingest` and `memory_status`.

Then add a short bootstrap note to your `CLAUDE.md`, `AGENTS.md` or `GEMINI.md` so the agent recalls at the start of a task and remembers only durable knowledge. Ready-made copies live in [`examples/`](examples).

Per-agent guides: [Claude Code](docs/integrations/claude-code.md) · [Codex](docs/integrations/codex.md) · [Gemini CLI](docs/integrations/gemini-cli.md) · [OpenCode](docs/integrations/opencode.md) · [OpenRouter](docs/integrations/openrouter.md) · [Custom agents](docs/integrations/custom-agents.md)

### Automatic memory (optional)

Instead of relying on the agent to call `memory_remember`, feed whole conversations in. Raw events are stored and durable knowledge is extracted conservatively. Chatter, questions, tool output and anything that looks like a secret are never stored as memories.

```bash
# Claude Code Stop hook (.claude/settings.json)
aam ingest --from-hook --agent claude --json

# Codex (~/.codex/config.toml)
notify = ["aam", "ingest", "--from-hook", "--agent", "codex", "--json"]

# Any tool: pipe JSON or JSONL messages
echo '[{"role":"user","content":"We decided to use Temporal for payroll."}]' | aam ingest --agent my-bot
```

## Using the TypeScript API

```bash
npm install @ai-agent-memory/core
```

```ts
import { createMemory } from "@ai-agent-memory/core";

const memory = await createMemory({ project: "my-app" });

await memory.remember({
  content: "Data processing uses Temporal workflows.",
  type: "architecture",
  importance: 0.9,
});

const results = await memory.recall({ query: "How does data processing work?", limit: 5 });
for (const r of results) console.log(r.score, r.memory.content, r.explanation);

await memory.inspect(results[0].memory.id); // provenance, scenes, supersedes, history

// Automatic mode: store raw events, extract knowledge, dedupe, detect conflicts
await memory.ingest({
  sessionId,
  agent: "claude",
  messages: [{ role: "user", content: "We decided to use Temporal for data processing." }],
});

await memory.close();
```

Full reference: [docs/api.md](docs/api.md)

## Optional semantic search

Keyword search (SQLite FTS5) is always on. To add vector search, set an embedding provider in `~/.config/ai-memory/config.json`:

```json
{ "embeddings": { "provider": "hash" } }
```

| Provider | Needs | Leaves the machine |
| --- | --- | --- |
| `hash` | Nothing | No |
| `local` | `@ai-agent-memory/embeddings` (transformers.js, in-process) | No |
| `ollama` | `@ai-agent-memory/embeddings` + a running Ollama | No |
| `openai` | `@ai-agent-memory/embeddings` + an API key | Yes |

Network providers also require `"privacy": { "allowNetworkEmbeddings": true }`. Run `aam embed` once to backfill existing memories. See [docs/configuration.md](docs/configuration.md).

## Packages

| Package | What it is |
| --- | --- |
| [`@ai-agent-memory/core`](packages/core) | Memory engine: types, `MemoryStore` interface, SQLite store, hybrid search, lifecycle, ingestion |
| [`@ai-agent-memory/cli`](packages/cli) | The `aam` command-line tool |
| [`@ai-agent-memory/mcp`](packages/mcp) | MCP server exposing the memory tools |
| [`@ai-agent-memory/embeddings`](packages/embeddings) | Optional embedding providers: OpenAI-compatible APIs, OpenRouter, Ollama, transformers.js |
| `@ai-agent-memory/adapter-*` | Bootstrap text, hooks and config snippets per agent ([claude](packages/adapters/claude), [codex](packages/adapters/codex), [gemini](packages/adapters/gemini), [opencode](packages/adapters/opencode), [openrouter](packages/adapters/openrouter)). No storage logic. |

## How it works

```text
Raw event → Extraction → Atomic memory → Dedup → Scoring → Scene clustering → Promotion → Core memory
```

- **Search** fuses FTS5 keyword results with optional vector results using Reciprocal Rank Fusion, then re-ranks by importance, confidence, recency, access frequency, scope and project match.
- **Lifecycle** runs on `aam consolidate`: expired memories are archived, strong ones are promoted to core, weak ones demoted, and related memories are clustered into scenes.
- **Privacy** is local by default. Nothing leaves the machine unless you opt into a network embedding provider. See [docs/security-privacy.md](docs/security-privacy.md).

## Documentation

- Concepts: [Architecture](docs/architecture.md) · [Memory model](docs/memory-model.md) · [Retrieval](docs/retrieval.md) · [Security & privacy](docs/security-privacy.md)
- Reference: [CLI](docs/cli.md) · [API](docs/api.md) · [MCP server](docs/mcp.md) · [Configuration](docs/configuration.md)
- Integrations: [Claude Code](docs/integrations/claude-code.md) · [Codex](docs/integrations/codex.md) · [Gemini CLI](docs/integrations/gemini-cli.md) · [OpenCode](docs/integrations/opencode.md) · [OpenRouter](docs/integrations/openrouter.md) · [Custom agents](docs/integrations/custom-agents.md)
- Examples: [`examples/`](examples)

## Development

```bash
corepack pnpm install
pnpm verify    # lint + format check + build + tests
pnpm smoke     # runs the built CLI and MCP server in a clean temp HOME
```

Requires Node.js 22.13 or newer and pnpm 12. See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/releasing.md](docs/releasing.md).

## License

[MIT](LICENSE)
