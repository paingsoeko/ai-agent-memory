# @ai-agent-memory/server

Local REST API + static host for the AI Memory web UI. Zero extra runtime
dependencies — plain Node.js `http`, backed by `@ai-agent-memory/core`.

## Run

```bash
# via the CLI (serves the built web UI + API together)
aam serve --port 4123
aam serve --db ~/.ai-memory/memory.db --open

# standalone binary
ai-memory-server --port 4123 --host 127.0.0.1 --db ~/.ai-memory/memory.db
```

## Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/health` | Liveness probe |
| GET | `/api/stats` | Memory/event/scene/project counts |
| GET | `/api/activity?limit=` | Recent memory + event activity |
| GET | `/api/memories?...` | Paginated list / keyword search (`q`, `level`, `type`, `scope`, `status`, `project`, `all`, `orderBy`, `order`, `limit`, `offset`) |
| POST | `/api/memories` | Remember (dedup + conflicts applied) |
| GET | `/api/memories/:id` | Full inspection: sources, scenes, lineage, related, history |
| PATCH | `/api/memories/:id` | Update fields |
| DELETE | `/api/memories/:id?archive=1` | Forget (hard delete) or archive |
| POST | `/api/memories/:id/promote` | Promote to core |
| POST | `/api/memories/:id/demote` | Demote to atomic |
| POST | `/api/memories/:id/resolve` | Resolve conflict (`{ loserId }`) |
| POST | `/api/memories/:id/supersede` | Supersede (`{ newerId }`) |
| GET | `/api/conflicts` | Memories with `status=conflicted` |
| GET | `/api/search?q=&mode=` | Pure relevance search (`keyword`/`semantic`/`hybrid`) with matched terms |
| GET/POST | `/api/scenes` | List / create scenes |
| GET/PATCH/DELETE | `/api/scenes/:id` | Scene detail (with members), update, delete |
| POST | `/api/scenes/:id/members` | Add memories (`{ memoryIds }`) |
| GET/POST | `/api/projects` | List / create projects (with counts) |
| GET | `/api/projects/:id` | Project detail, scenes, decisions, top core |
| GET | `/api/sessions` | List agent sessions (with counts) |
| GET | `/api/sessions/:id` | Session detail: events + memories |
| GET | `/api/sources` (`/api/events` alias) | Raw events (paginated, filterable) |
| GET | `/api/sources/:id` | Event + derived memories |
| GET | `/api/privacy` | Privacy posture |
| GET | `/api/config` | Effective search/embedding/privacy config |
| POST | `/api/consolidate` | Expiry + promotion + scenes + embeddings |
| POST | `/api/embed` | Backfill embeddings |
| GET | `/api/export` | Full JSON export |

Collections never dump the whole database: list endpoints are capped
(`limit` ≤ 500) and search fuses ranked candidates server-side.

## Programmatic use

```ts
import { startServer } from "@ai-agent-memory/server";

const srv = await startServer({
  port: 4123,
  staticDir: "./packages/web/dist", // SPA fallback included
  path: ":memory:",
});
// ... fetch(`${srv.url}/api/stats`)
await srv.close();
```
