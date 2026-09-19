# @ai-agent-memory/web

Memory inspection and management dashboard for the local-first AI Agent
Memory system. Not a chat app — it answers: *what does my AI remember,
where did it come from, why is it remembered, and where is it used?*

## Stack

React 19 + TypeScript + Vite. Hand-rolled design-system CSS (Linear /
Raycast-grade minimal developer-tool aesthetic), Lucide icons, hash routing
(works from any static host), zero runtime UI framework dependencies beyond
React. The UI only talks to the memory engine through the REST API in
`@ai-agent-memory/server` — no database logic in components.

## Develop

```bash
pnpm --filter @ai-agent-memory/web dev      # vite on :4124, /api proxied to :4123
aam serve                                    # API + built UI on :4123
```

Open `http://127.0.0.1:4123/?demo=1` to preview with built-in demo data
(no database needed), or `?empty=1` to review empty states.

## Routes

`#/overview` · `#/memories` · `#/scenes` · `#/scene/:id` · `#/core` ·
`#/projects` · `#/project/:id` · `#/sessions` · `#/session/:id` ·
`#/sources` · `#/source/:id` · `#/search` · `#/conflicts` · `#/settings`

## Shortcuts

`⌘K` global search · `⌘/` focus memory search · `Esc` close drawer/modal ·
`j`/`k` move in list · `Enter` open · `E` edit · `t` toggle theme.
