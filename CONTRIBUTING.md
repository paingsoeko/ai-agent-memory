# Contributing

```bash
corepack pnpm install
pnpm verify      # lint, format check, build, tests
pnpm smoke       # built CLI + MCP server in a clean temp HOME
pnpm test:watch  # vitest
```

Layout: `packages/core` (engine), `packages/cli`, `packages/mcp`, `packages/embeddings`, `packages/adapters/*`, `examples/`, `docs/`, `tests/` (cross-package integration + smoke).

Rules of the road:

- The core must stay vendor- and agent-agnostic and dependency-free. Anything that talks to a specific API lives in `embeddings` or an adapter.
- Never destroy provenance: raw events survive memory deletion; conflicts supersede rather than overwrite.
- Every behaviour change needs a test. Tests use `:memory:` or a temp directory; never the user's real database.
- Keep the public API small. Prefer options on existing methods over new methods.
- Run `pnpm format` before committing.

Releases: bump versions in the package manifests, update `CHANGELOG.md`, tag `vX.Y.Z`; the release workflow publishes every package under `packages/` with npm provenance.
