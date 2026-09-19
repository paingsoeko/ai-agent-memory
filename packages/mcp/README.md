# @ai-memory/mcp

MCP server (stdio) that exposes the local ai-memory store to any MCP-capable agent: `memory_recall`, `memory_search`, `memory_remember`, `memory_update`, `memory_forget`, `memory_inspect`, `memory_list`, `memory_ingest`, `memory_status`.

```bash
npx -y @ai-memory/mcp
claude mcp add ai-memory -- npx -y @ai-memory/mcp
```

No cloud dependency: it opens the same SQLite file as the CLI. Docs: https://github.com/paingsoeko/ai-agent-memory/blob/main/docs/mcp.md
