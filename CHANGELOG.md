# Changelog

## 0.1.0

Initial release.

- `@local-ai-agent-memory/core`: SQLite (node:sqlite) store with FTS5, layered memory model (events → atomic → scenes → core), hybrid search with RRF and reranking, deduplication, conflict superseding, promotion, expiry, provenance, heuristic ingestion, config loading, export/import, built-in local hashing embeddings.
- `@local-ai-agent-memory/cli`: `ai-memory` with JSON output, hook-aware ingestion, project management.
- `@local-ai-agent-memory/mcp`: stdio MCP server exposing the memory tools.
- `@local-ai-agent-memory/embeddings`: OpenAI-compatible, OpenRouter, Ollama and transformers.js providers.
- Adapters for Claude Code, Codex, Gemini CLI, OpenCode and OpenRouter.
