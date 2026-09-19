# Security & privacy

## Defaults

```text
Storage:    local SQLite file (~/.ai-memory/memory.db)
Telemetry:  disabled — there is no telemetry code path
Analytics:  disabled
Cloud sync: none
Network:    disabled
```

`aam privacy` prints the live posture, including which embedding provider is active and whether it needs the network.

The core package has no runtime dependencies and makes no network calls. The CLI and MCP server only talk to the local database.

## When the network is used

Only if you configure an embedding provider that needs it (`ollama`, `openai`, `openai-compatible`, `openrouter`). Two safeguards apply:

1. `privacy.allowNetworkEmbeddings` must be `true` (or `AI_MEMORY_ALLOW_NETWORK_EMBEDDINGS=1`); otherwise `createMemory` refuses to start with that provider and tells you why.
2. Memories marked `sensitive` are **never** sent to a provider with `requiresNetwork = true`. Content that looks like a credential (API keys, tokens, private keys, JWTs, `password=` pairs, card/SSN-like numbers) is marked sensitive automatically, and the ingest extractor drops such sentences entirely.

What is sent: only the memory text (or query text) being embedded, to the endpoint you configured. Nothing else — no metadata, no project names, no file paths.

The `local` provider (transformers.js) runs in-process; it downloads model weights from the Hugging Face Hub the first time unless `options.localFilesOnly` is set. No memory text leaves the machine.

## Data at rest

The database is a plain SQLite file with your user's file permissions. **It is not encrypted in v1.** Anyone with read access to the file can read your memories. Recommendations:

- Keep `~/.ai-memory` on an encrypted volume (FileVault, LUKS, BitLocker).
- Do not commit `.ai-memory.json` files that point `storage.path` at a database inside a repository unless you intend to share it; `*.db` is in the default `.gitignore`.
- Use `aam forget` / `memory_forget` to delete; deletion removes the memory row (and its scene/embedding rows via cascade) but keeps raw events for provenance. Use `aam forget` on events' derived memories and `VACUUM` (`store.vacuum()`) if you need bytes physically reclaimed.

Encryption roadmap: the storage layer is behind the `MemoryStore` interface, so an encrypted store (for example SQLCipher through a native driver, or application-level encryption of `content`) can be added as a separate package without changing the engine. This is documented as a limitation, not hidden.

## Multi-agent sharing

All agents on the machine that point at the same file share the same memories, by design. Use different `storage.path` values (per user, per client) if you need separation. Project isolation is enforced in every query; it is a logical boundary inside one file, not a security boundary.

## Prompt-injection surface

Memories are data that agents read back into their context. The adapters' bootstrap text tells agents to treat memories as prior context, not as instructions. Automatic ingestion only stores sentences matching durable-knowledge patterns and never stores tool output, but any agent that can call `memory_remember` can store arbitrary text — review with `aam list` and `inspect` when in doubt.
