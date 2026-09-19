# Web UI

The web UI is a **memory inspection and management dashboard** (not a chat
app) for the local-first memory system. It answers: *what does my AI
remember, where did it come from, why is it remembered, and where is it
being used?*

## Run it

```bash
aam serve                 # http://127.0.0.1:4123
aam serve --open          # also open the browser
aam serve --port 8080 --db ~/.ai-memory/memory.db
```

`aam serve` starts the REST API from `@ai-agent-memory/server` and serves
the built dashboard from `@ai-agent-memory/web` on the same origin. The
API alone is also available (`ai-memory-server --port 4123`), and the UI
can be developed standalone:

```bash
pnpm --filter @ai-agent-memory/web dev   # :4124, /api proxied to :4123
```

Append `?demo=1` to any URL for built-in demo data (no database needed),
or `?empty=1` to preview empty states.

## Pages

- **Overview** — compact stats, recent activity, memory growth.
- **Memories** — hybrid/keyword/semantic search, level shortcuts, popover
  filters (project, type, scope, status), sorting, paginated list, `j`/`k`
  navigation. Clicking a row opens the detail drawer.
- **Memory Network** — neuron-graph visualization of the L0 → L1 → L2 → L3
  architecture: force-directed layout with soft layer bands, L3 core backbone
  with subtle glow, typed synaptic edges (strength = line weight), hover
  cards, click to inspect, double-click to focus, right-click menu
  (inspect/focus/edit/archive/delete), focus dimming, layer filters,
  search-driven recall paths (L3 → L2 → L1 → L0 animated), conflict and
  supersede states, stats overlay, minimap, and level-of-detail caps so
  100k+ memories stay interactive. Every node/edge maps to real data via
  `GET /api/memory-graph`.
- **Detail drawer** — confidence/importance, provenance timeline
  (core → scene → session → original message, every node clickable),
  supersede lineage, related memories, history; edit, archive, delete.
- **Scenes** — topic clusters with summaries and member lists.
- **Core Memory** — curated long-term knowledge grouped by section, with
  promote/demote, provenance inspection and delete.
- **Projects** — per-project counts with overview/memories/scenes/
  decisions/sessions/sources tabs.
- **Sessions** — agent timeline grouped by day, with duration, message and
  memory counts plus linked events.
- **Sources** — raw provenance events by type (conversation, tool result,
  git commit, manual, imported, agent session), each showing the original
  content and derived memories.
- **Search** — `⌘K`/`Ctrl+K` command palette everywhere, full search page
  with mode indicator and per-result match explanations (matched terms,
  semantic score — never raw vectors).
- **Conflicts** — flagged contradictions with keep-older / keep-newer /
  keep-both; nothing is auto-resolved.
- **Settings** — storage path and size, search/embedding status, privacy
  posture (local-only), integration snippets.

## Notes

- Every collection endpoint is paginated server-side; the UI stays fast
  with 100k+ memories.
- Light and dark mode follow the OS setting (toggle with `t` or the
  top-bar button); `prefers-reduced-motion` is respected.
- Destructive actions confirm first and prefer archive over delete.
