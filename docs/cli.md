# CLI (`@ai-agent-memory/cli`)

```bash
npm install -g @ai-agent-memory/cli
aam --help
```

| Command | Description |
| --- | --- |
| `init` | Create the database and a default user config |
| `status` | Stats, active project, embedding provider, config sources |
| `remember <text> [-t type] [--importance x] [--confidence x] [--scope s] [--tags a,b] [--scene name] [--ttl 7d] [--force] [--sensitive]` | Store a memory |
| `recall <query> [-n limit] [--core] [--mode keyword\|semantic\|hybrid] [-t type] [--verbose]` | Ranked recall (records access) |
| `search <query> [...]` | Pure relevance search |
| `list [-t type] [--scope s] [--level atomic\|core] [--status ...] [--order-by ...] [-n] [--offset] [--include-expired]` | List memories |
| `inspect <id>` | Provenance, history, scenes, related |
| `update <id> [--content ...] [--type ...] [--importance ...] [--tags ...] [--status ...] [--level ...] [--ttl ...]` | Patch a memory |
| `forget <id> [--archive]` | Delete (raw events kept) or archive |
| `promote <id>` / `demote <id>` | Core level |
| `project create\|use\|list\|current\|delete <name>` | Projects. `use` writes `.ai-memory.json` |
| `scene list` / `scene show <id>` / `scene update <id> --name --summary` | Scenes |
| `events [--session id] [--agent name] [-n]` | Raw events |
| `ingest [file] [--session id] [--agent name] [--raw-only] [--from-hook]` | Ingest JSON / JSONL / Claude transcript / hook payload (stdin when no file) |
| `consolidate [--all-projects]` | Lifecycle pass |
| `embed [-n limit]` | Backfill embeddings |
| `export [file] [--embeddings]` / `import <file> [--overwrite]` | Portable JSON |
| `privacy` | Privacy posture |
| `config` | Effective configuration and its sources |
| `mcp` | MCP setup snippets |

Global flags: `--json`, `-p/--project <name>`, `-g/--global`, `--all-projects`, `--db <path>`, `--config <path>`, `--verbose`.

## JSON output

`--json` prints stable JSON on stdout for agents. Errors go to stderr as `{"error":{"code","message","hint"}}`. Exit codes: `0` ok, `1` error, `2` usage, `3` not found.

```bash
aam recall "Temporal" --json
```

```json
[
  {
    "id": "df89c9da-…",
    "score": 0.71,
    "source": "keyword",
    "explanation": "keyword #1; importance 0.50; confidence 0.80; recency 1.00; project match",
    "memory": { "content": "Payroll uses Temporal.", "type": "fact", "scope": "project", "projectId": "demo", "...": "..." }
  }
]
```

## Ingest input formats

- JSON array of `{ role, content }` (content may be a string or an array of `{ type: "text", text }` blocks)
- `{ "messages": [...] }`
- JSONL, one message per line
- Claude Code transcripts (`{ type, message: { role, content } }` lines; tool results are skipped)
- `--from-hook`: a hook payload on stdin or as an argument — Claude Code Stop/SessionEnd JSON (`transcript_path`, `session_id`) or Codex `notify` JSON (`input-messages`, `last-assistant-message`)
