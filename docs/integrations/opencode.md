# OpenCode

## MCP server

`opencode.json` (project) or `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ai-memory": { "type": "local", "command": ["npx", "-y", "@ai-agent-memory/mcp"], "enabled": true }
  }
}
```

## Instructions

Append `opencodeAdapter.bootstrapInstructions()` (from `@ai-agent-memory/adapter-opencode`) to `AGENTS.md`.

## Plugin for automatic ingestion

`.opencode/plugin/ai-memory.ts` (see `examples/opencode/`): on `session.idle` the plugin reads the session messages through the OpenCode client and pipes them to `aam ingest`. The OpenCode plugin API is still evolving; the example targets the `event` hook and Bun's `$` shell helper.
