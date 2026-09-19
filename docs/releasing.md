# Releasing

Publishing is automated by `.github/workflows/publish.yml` and authenticated with **npm Trusted Publishing (GitHub OIDC)**. No npm token is stored anywhere.

```text
pnpm release:version patch      # bumps root + all packages, commits, tags vX.Y.Z
git push origin main --follow-tags
        ↓
GitHub Actions (publish.yml, triggered by the v* tag)
        ↓ pnpm install --frozen-lockfile → lint → typecheck → test → build → smoke
        ↓ check-versions: every package.json version == tag
        ↓ npm pack --dry-run for every package
        ↓ for each package: skip if name@version already on npm, else pnpm pack → npm publish --provenance
        ↓
npm registry (with provenance attestations)
```

## One-time setup

1. **First publish must be manual.** npm only lets you configure a Trusted Publisher on a package that already exists. From a logged-in shell (`npm whoami`):
   ```bash
   pnpm verify && pnpm smoke
   pnpm -r --filter './packages/**' publish --access public
   ```
2. **Configure a Trusted Publisher on each package** at `https://www.npmjs.com/package/<name>/access` → *Trusted Publisher* → *GitHub Actions*:
   - Organization or user: `paingsoeko`
   - Repository: `ai-agent-memory`
   - Workflow filename: `publish.yml`
   - Environment name: `npm`
3. **Create the `npm` environment** in GitHub (Settings → Environments → New → `npm`). Optionally add required reviewers so every publish needs approval.

## Every release

```bash
pnpm release:version patch     # or minor | major | 1.2.3
git push origin main --follow-tags
```

Watch the *Publish to npm* workflow. Verify:

```bash
npm view @ai-agent-memory/core version
npm view @ai-agent-memory/cli dist.tarball
```

Rehearse without publishing: *Actions → Publish to npm → Run workflow* (dry-run defaults to true), or locally `pnpm release:dry-run`.
