# Claude Code example

Copy `.mcp.json`, `.claude/settings.json`, `CLAUDE.md` and `.ai-memory.json` into a repository. Claude Code will:

1. load the `ai-memory` MCP server (`memory_recall`, `memory_remember`, ...),
2. print relevant + core memories at session start (hook),
3. ingest the transcript when it stops (hook) — raw events are stored, durable knowledge extracted.

Generate these files for any project with `@ai-memory/adapter-claude` (`claudeAdapter.mcpConfig()`, `claudeAdapter.hooks()`, `claudeAdapter.bootstrapInstructions()`).
