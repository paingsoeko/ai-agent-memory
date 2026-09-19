# ai-memory

**A local-first, agent-agnostic memory layer for AI coding agents.**

```text
Claude Code ─┐
Codex ───────┤
Gemini CLI ──┤
OpenCode ────┤──→  ai-memory  ──→  local SQLite (FTS5 + optional embeddings)
OpenRouter ──┤
Custom ──────┘
```

One memory. Any agent. Your machine. No vendor lock-in.

- **Local-first.** Everything lives in a single SQLite file (`~/.ai-memory/memory.db`). No cloud, no account, no API key, no telemetry.
- **Agent-agnostic.** The engine has zero agent- or vendor-specific code. Agents connect over [MCP](docs/mcp.md), the CLI (`--json`), or the TypeScript API.
- **Layered memory.** Raw events (L0) → atomic memories (L1) → scenes (L2) → core memories (L3), with full provenance at every step.
- **Conservative by default.** Paraphrases are merged, conflicting facts are superseded (never silently overwritten), and automatic ingestion prefers *not remembering* over remembering noise.
- **Zero runtime dependencies** in the core: it uses Node's built-in `node:sqlite` (Node ≥ 22.13).

## Quick start

```bash
npm install -g @ai-agent-memory/cli

aam init
aam remember "I prefer PostgreSQL for backend projects."
aam recall "database preference"
```

```text
0.734  3f9c1a2e  [preference | user]  I prefer PostgreSQL for backend projects.
```

## How to use

### 1. Install and initialise

```bash
npm install -g @ai-agent-memory/cli     # gives you the `aam` command
aam init                          # creates ~/.ai-memory/memory.db and ~/.config/ai-memory/config.json
aam status                        # database stats, active project, config sources
```

Requires Node.js 22.13 or newer. Nothing is sent anywhere: `aam privacy` shows the posture.

### 2. Pick a project

Memories are isolated per project. Inside a repository run:

```bash
cd ~/code/my-app
aam project use my-app            # writes .ai-memory.json in this directory
aam project current               # -> my-app
```

Without `project use`, the git root folder name is used automatically. Memories stored with `--global` (or `--scope user`) are visible in every project, which is where personal preferences belong.

### 3. Remember things

```bash
aam remember "Data processing uses Temporal workflows." -t architecture --importance 0.9
aam remember "Always run pnpm lint before committing." -t convention
aam remember "I prefer PostgreSQL for backend projects." -t preference --global
aam remember "Database = MySQL" -t architecture
aam remember "Database = PostgreSQL" -t architecture     # -> supersedes the MySQL memory, both kept
aam remember "Payroll uses Temporal."                       # -> merged into the existing Temporal memory
```

Types: `fact` (default), `preference`, `decision`, `architecture`, `convention`, `pattern`, `bug_fix`, `lesson`, `task`, `constraint`, `persona`, `project_context`, `summary`, or any custom string. Useful flags: `--tags a,b`, `--scene "Payroll Architecture"`, `--ttl 7d` (short-term), `--sensitive` (never sent to a network embedding provider), `--force` (skip dedup).

### 4. Recall and search

```bash
aam recall "how does data processing work?"      # ranked for a task, records access
aam recall "payroll" --core --verbose               # include core memories, show why each ranked
aam search "trace propagation" -t architecture      # pure relevance, no side effects
aam list --level core                               # everything promoted to core
aam list --status superseded                        # history of replaced facts
```

`recall` ranks by relevance, importance, confidence, recency, access frequency and project match. Memories from the current project outrank global ones.

### 5. Inspect, edit, forget

```bash
aam inspect 3f9c1a2e            # provenance (raw events), scenes, supersedes links, related, history
aam update 3f9c1a2e --importance 0.95 --tags db,infra
aam promote 3f9c1a2e            # force to core (L3)
aam forget 3f9c1a2e             # delete (raw events are kept); add --archive to hide instead
aam scene list                  # topic groups (L2)
```

Ids can be abbreviated to any unique prefix.

### 6. Connect your agents

Every agent talks to the same database over MCP:

```bash
claude mcp add ai-memory -- npx -y @ai-agent-memory/mcp       # Claude Code
codex mcp add ai-memory -- npx -y @ai-agent-memory/mcp        # Codex
aam mcp                                                 # snippets for Gemini CLI, OpenCode, generic JSON
```

Then paste the bootstrap text into `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` so the agent knows to call `memory_recall` at the start of a task and `memory_remember` only for durable knowledge (ready-made copies are in [`examples/`](examples)). A fact remembered by Claude Code is recalled by Codex, Gemini CLI, OpenCode and your own scripts.

### 7. Automatic memory (optional)

Let agents feed conversations in; raw events are stored and durable knowledge is extracted conservatively:

```bash
# Claude Code Stop hook (.claude/settings.json) — reads the transcript path from the hook payload
aam ingest --from-hook --agent claude --json

# Codex (~/.codex/config.toml)
notify = ["aam", "ingest", "--from-hook", "--agent", "codex", "--json"]

# Any tool: pipe JSON / JSONL messages
echo '[{"role":"user","content":"We decided to use Temporal for payroll."}]' | aam ingest --agent my-bot
```

Chatter, questions, tool output and anything that looks like a secret are never stored as memories.

### 8. Use from scripts (`--json`)

Every command accepts `--json` and prints stable JSON on stdout, errors on stderr with exit codes `1` (error), `2` (usage), `3` (not found):

```bash
aam recall "Temporal" --json | jq '.[0].memory.content'
```

### 9. Maintenance

```bash
aam consolidate            # archive expired, promote/demote, cluster scenes, backfill embeddings
aam export ./memory.json   # portable backup (add --embeddings to include vectors)
aam import ./memory.json   # merge into another machine's database
aam config                 # effective configuration and where each value came from
```

### 10. Optional semantic search

Keyword search (FTS5) is always on. To add embeddings, edit `~/.config/ai-memory/config.json`:

```json
{ "embeddings": { "provider": "hash" } }
```

`hash` is local and dependency-free. For neural embeddings install `@ai-agent-memory/embeddings` and use `"local"` (transformers.js, in-process), `"ollama"`, or `"openai"`; network providers additionally require `"privacy": { "allowNetworkEmbeddings": true }`. Run `aam embed` once to backfill. See [docs/configuration.md](docs/configuration.md).

## Programmatic API

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
await memory.close();
```

Automatic mode: hand the engine a conversation and it stores raw events, extracts durable knowledge, deduplicates, detects conflicts and links provenance:

```ts
await memory.ingest({
  sessionId,
  agent: "claude",
  messages: [{ role: "user", content: "We decided to use Temporal for data processing." }],
});
```

See [docs/api.md](docs/api.md) for the full API.

## Packages

| Package | What it is |
| --- | --- |
| [`@ai-agent-memory/core`](packages/core) | Memory engine, types, `MemoryStore` interface, SQLite store, hybrid search, lifecycle, ingestion |
| [`@ai-agent-memory/cli`](packages/cli) | `ai-memory` command-line tool (`--json` for agents) |
| [`@ai-agent-memory/mcp`](packages/mcp) | MCP server exposing `memory_search`, `memory_recall`, `memory_remember`, `memory_update`, `memory_forget`, `memory_inspect`, `memory_list`, `memory_ingest`, `memory_status` |
| [`@ai-agent-memory/embeddings`](packages/embeddings) | Optional embedding providers: OpenAI-compatible APIs, OpenRouter, Ollama, transformers.js |
| [`@ai-agent-memory/adapter-claude`](packages/adapters/claude), [`-codex`](packages/adapters/codex), [`-gemini`](packages/adapters/gemini), [`-opencode`](packages/adapters/opencode), [`-openrouter`](packages/adapters/openrouter) | Bootstrap instructions, hooks, config snippets and context formatting per agent (no storage logic) |

## How it works

```text
Raw event ─→ Extraction ─→ Atomic memory ─→ Dedup ─→ Scoring ─→ Scene clustering ─→ Promotion ─→ Core memory
```

- **Search** is hybrid: SQLite FTS5 keyword search (always on) plus optional vector search, fused with Reciprocal Rank Fusion and re-ranked by importance, confidence, recency, access frequency, scope and project match. [docs/retrieval.md](docs/retrieval.md)
- **Scopes** are hierarchical (`global → user → project → workspace → session`). A project's memories never leak into another project unless you pass `allProjects`. [docs/memory-model.md](docs/memory-model.md)
- **Conflicts** are tracked with `status`, `supersedes` and `supersededBy`, so "Database = MySQL" becomes superseded when you later remember "Database = PostgreSQL" — and both remain inspectable. 
- **Provenance**: `aam inspect <id>` shows the raw events a memory was derived from, its scenes, what it supersedes, related memories and its full lifecycle history.
- **Privacy**: `aam privacy` shows the posture (storage local, telemetry disabled, network disabled unless you opt into a network embedding provider). [docs/security-privacy.md](docs/security-privacy.md)

## Documentation

- [Architecture](docs/architecture.md) · [Memory model](docs/memory-model.md) · [Retrieval](docs/retrieval.md) · [MCP server](docs/mcp.md) · [API](docs/api.md) · [CLI](docs/cli.md) · [Configuration](docs/configuration.md) · [Security & privacy](docs/security-privacy.md)
- Integrations: [Claude Code](docs/integrations/claude-code.md) · [Codex](docs/integrations/codex.md) · [Gemini CLI](docs/integrations/gemini-cli.md) · [OpenCode](docs/integrations/opencode.md) · [OpenRouter](docs/integrations/openrouter.md) · [Custom agents](docs/integrations/custom-agents.md)
- Examples: [`examples/`](examples)

## Development

```bash
corepack pnpm install
pnpm verify          # lint + format check + build + tests
pnpm smoke           # runs the built CLI + MCP server in a clean temp HOME
```

Requirements: Node.js ≥ 22.13 (LTS 22 or 24), pnpm 12.

## License

MIT
