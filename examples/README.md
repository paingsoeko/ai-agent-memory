# Examples

| Directory | Shows |
| --- | --- |
| `basic-usage/` | The TypeScript API end to end (remember, dedup, conflicts, ingest, recall, inspect) |
| `claude-code/` | `.mcp.json`, hooks in `.claude/settings.json`, `CLAUDE.md` |
| `codex/` | `~/.codex/config.toml` MCP entry + `notify` hook, `AGENTS.md` |
| `gemini/` | `.gemini/settings.json`, `/memory` custom command, `GEMINI.md` |
| `opencode/` | `opencode.json`, ingestion plugin, `AGENTS.md` |
| `openrouter/` | A custom agent using OpenRouter with memory in the system prompt |

All of them point at the same local database, so a fact remembered by Claude Code is recalled by Codex, Gemini CLI, OpenCode and your own agents.
