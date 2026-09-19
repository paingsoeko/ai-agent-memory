# OpenAI Codex CLI

## MCP server

`~/.codex/config.toml`:

```toml
[mcp_servers.ai-memory]
command = "npx"
args = ["-y", "@local-ai-agent-memory/mcp"]
```

or `codex mcp add ai-memory -- npx -y @local-ai-agent-memory/mcp`.

## Instructions

Append `codexAdapter.bootstrapInstructions()` (from `@local-ai-agent-memory/adapter-codex`) to `AGENTS.md` in the repository or `~/.codex/AGENTS.md`.

## Automatic ingestion via `notify`

Codex runs the `notify` command after every turn with a JSON payload (`type: "agent-turn-complete"`, `input-messages`, `last-assistant-message`). Point it at the CLI:

```toml
notify = ["aam", "ingest", "--from-hook", "--agent", "codex", "--json"]
```

The project is detected from the working directory (`.ai-memory.json` / git root). See `examples/codex/`.
