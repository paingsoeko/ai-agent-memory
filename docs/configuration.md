# Configuration

Priority (low → high): built-in defaults < `~/.config/ai-memory/config.json` < nearest `.ai-memory.json` walking up from the working directory < environment variables < programmatic / CLI options.

```json
{
  "storage": { "type": "sqlite", "path": "~/.ai-memory/memory.db" },
  "search": {
    "keyword": true,
    "semantic": false,
    "candidateLimit": 50,
    "rrfK": 60,
    "recencyHalfLifeDays": 60,
    "weights": { "relevance": 0.55, "importance": 0.15, "confidence": 0.08, "recency": 0.08, "access": 0.04, "project": 0.07, "level": 0.03 }
  },
  "embeddings": { "provider": "none", "model": null, "baseUrl": null, "apiKey": null, "dimensions": null, "batchSize": 32, "eager": true },
  "memory": {
    "defaultScope": "project",
    "autoPromotion": true,
    "autoScenes": true,
    "autoDetectProject": true,
    "dedup": { "enabled": true, "threshold": 0.75, "semanticThreshold": 0.92 },
    "conflicts": { "policy": "supersede" },
    "promotion": { "minEvidence": 3, "minImportance": 0.6, "minConfidence": 0.7, "minAgeMs": 0, "minAccessCount": 0 },
    "sessionTtlMs": 604800000,
    "ingest": { "minConfidence": 0.6, "maxPerBatch": 20 }
  },
  "privacy": { "telemetry": false, "allowNetworkEmbeddings": false },
  "project": "my-app"
}
```

Project-level `.ai-memory.json` typically only contains `{ "project": "name" }` (written by `aam project use`), but may override anything. A relative `storage.path` in a project file resolves against that file's directory, which lets a team keep a per-repo database.

## Environment variables

| Variable | Effect |
| --- | --- |
| `AI_MEMORY_DB_PATH` | Database file |
| `AI_MEMORY_HOME` | Directory containing `memory.db` |
| `AI_MEMORY_CONFIG` | User config file path |
| `AI_MEMORY_PROJECT` | Active project |
| `AI_MEMORY_DEFAULT_SCOPE` | `memory.defaultScope` |
| `AI_MEMORY_EMBEDDINGS_PROVIDER` / `_MODEL` / `_BASE_URL` / `_API_KEY` | Embedding provider settings |
| `AI_MEMORY_SEMANTIC_SEARCH` | `1`/`true` to enable semantic search |
| `AI_MEMORY_ALLOW_NETWORK_EMBEDDINGS` | `1`/`true` to allow network providers |
| `XDG_CONFIG_HOME` | Base for the user config path |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENROUTER_API_KEY`, `OLLAMA_HOST` | Read by the corresponding providers |

`aam config` prints the effective configuration and the list of sources it was merged from.

## Embedding providers

| `embeddings.provider` | Package | Notes |
| --- | --- | --- |
| `none` | core | Keyword search only (default) |
| `hash` | core | Local lexical hashing embedding; deterministic; no dependencies |
| `local` / `transformers` | embeddings + `@huggingface/transformers` | Neural, in-process; model downloaded once |
| `ollama` | embeddings | `baseUrl` default `http://127.0.0.1:11434`, `model` default `nomic-embed-text`; needs `allowNetworkEmbeddings` |
| `openai` / `openai-compatible` / `openrouter` | embeddings | Remote; needs `apiKey` and `allowNetworkEmbeddings` |

Setting a provider automatically enables `search.semantic`. Embeddings are stored per model, so changing providers just requires `aam embed` to backfill.
