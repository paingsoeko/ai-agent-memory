# Retrieval

```text
Query
 ├── Keyword search  → FTS5 (porter + unicode61, bm25 with tag column weighted 0.4)
 ├── Semantic search → embeddings (only if a provider is configured)
 └── Reciprocal Rank Fusion  →  Reranking  →  Final results
```

## Keyword search

`buildFtsQuery()` turns free text into a safe FTS5 expression: tokens are quoted, stopwords removed, and tokens with ≥ 4 characters also match as prefixes (`"generation" OR "generation"*`). Tokens are OR-ed so partial matches still rank; bm25 rewards documents that match more terms. The porter tokenizer gives stemming ("executing" matches "execute").

## Semantic search

When an `EmbeddingProvider` is configured, the query is embedded and compared by cosine similarity against stored vectors of the same model. The scan streams rows in chunks and keeps a top-k heap, so it never materialises the whole table.

Providers:

| name | where the text goes | requires opt-in |
| --- | --- | --- |
| `hash` (built-in) | nowhere — deterministic lexical hashing | no |
| `local` / `transformers` | in-process ONNX model via transformers.js; model files downloaded once | no (install `@huggingface/transformers`) |
| `ollama` | local Ollama HTTP server | yes (`privacy.allowNetworkEmbeddings`) |
| `openai`, `openai-compatible`, `openrouter` | remote API | yes |

## Reciprocal Rank Fusion

For each ranked list *i* and document *d*: `score(d) = Σ 1 / (k + rank_i(d))`, `k = search.rrfK` (60). A document ranked first by both lists beats one ranked first by only one.

## Reranking

`search()` returns pure relevance (normalised RRF). `recall()` applies the boosts an agent wants:

```text
final = w.relevance · rrf_norm
      + w.importance · importance
      + w.confidence · confidence
      + w.recency    · 0.5^(ageDays / halfLifeDays)
      + w.access     · log1p(accessCount) / log1p(50)
      + w.project    · [memory.projectId == query.projectId]
      + w.level      · [level == core]
```

Default weights: relevance 0.55, importance 0.15, confidence 0.08, recency 0.08, access 0.04, project 0.07, level 0.03 (`search.weights`). Every result carries an `explanation` string, e.g. `keyword #1, semantic #2; importance 0.90; confidence 0.80; recency 0.98; project match`.

`recall()` also records access (`accessCount`, `lastAccessedAt`) for the returned page, which feeds both the access boost and promotion evidence. `search()` does not.

Filters available on both: `projectId`, `allProjects`, `scope`, `type`, `level`, `status`, `tags`, `sessionId`, `agent`, `minImportance`, `minConfidence`, `createdAfter/Before`, `includeExpired`, `limit`, `offset`, `mode`.
