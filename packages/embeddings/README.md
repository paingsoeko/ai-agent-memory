# @local-ai-agent-memory/embeddings

Optional embedding providers for ai-memory. Importing this package registers `openai`, `openai-compatible`, `openrouter`, `ollama`, `local`/`transformers` by name; the built-in `hash` provider in core needs nothing.

Network providers require `privacy.allowNetworkEmbeddings = true`; sensitive memories are never sent. `local` needs the optional `@huggingface/transformers` package and runs fully in-process.

Docs: https://github.com/paingsoeko/ai-agent-memory/blob/main/docs/configuration.md
