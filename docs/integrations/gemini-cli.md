# Gemini CLI

## MCP server

`~/.gemini/settings.json` (user) or `.gemini/settings.json` (project):

```json
{
  "mcpServers": {
    "ai-memory": { "command": "npx", "args": ["-y", "@local-ai-agent-memory/mcp"], "timeout": 30000, "trust": false }
  }
}
```

## Instructions

Append `geminiAdapter.bootstrapInstructions()` (from `@local-ai-agent-memory/adapter-gemini`) to `GEMINI.md`.

## Custom command (no MCP needed)

`.gemini/commands/memory.toml`:

```toml
description = "Recall relevant memories for the current task"
prompt = "Run the shell command !{aam recall \"{{args}}\" --limit 10} and use the output as context for the task: {{args}}"
```

Then `/memory payroll generation` inside Gemini CLI. See `examples/gemini/`.
