# Claude Code

## 1. Register the MCP server

```bash
claude mcp add ai-memory -- npx -y @ai-memory/mcp
# project-scoped alternative: add to .mcp.json
```

```json
{ "mcpServers": { "ai-memory": { "command": "npx", "args": ["-y", "@ai-memory/mcp"] } } }
```

Claude then sees `memory_recall`, `memory_remember`, `memory_search`, `memory_inspect`, `memory_forget`, `memory_update`, `memory_list`, `memory_ingest`, `memory_status`.

## 2. Bootstrap instructions

Append the output of the adapter to `CLAUDE.md` (project) or `~/.claude/CLAUDE.md` (user):

```bash
node -e 'import("@ai-memory/adapter-claude").then(m => console.log(m.claudeAdapter.bootstrapInstructions({ project: "my-app" })))' >> CLAUDE.md
```

## 3. Hooks (automatic mode)

`.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "aam recall \"project overview, conventions and recent decisions\" --core --limit 12 2>/dev/null || true" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "aam ingest --from-hook --agent claude --json >/dev/null 2>&1 || true" }] }]
  }
}
```

- **SessionStart** prints relevant and core memories; Claude Code adds hook stdout to the session context.
- **Stop** receives the hook JSON on stdin (`transcript_path`, `session_id`); `aam ingest --from-hook` reads the JSONL transcript, stores the messages as raw events and extracts durable knowledge conservatively.

The active project is detected from `.ai-memory.json` or the git root name, so the same hooks work in every repository. See `examples/claude-code/`.
