# GitHub Actions — billing-free mode

**Production deploy and match refresh no longer run on GitHub Actions.**

GitHub Actions billing was blocking deploys. The repo now uses:

| What | Where it runs | Trigger |
|------|----------------|---------|
| **Deploy** (`wrangler deploy`) | **Cloudflare Workers Builds** | Push / merge to `main` |
| **Match refresh** (optional) | Cloudflare build step or manual | See `config/cloudflare-workers-builds.json` |
| **Code** | GitHub | PRs, merges — unchanged |

## Workflows in this folder

| File | Auto-trigger | Purpose |
|------|--------------|---------|
| `deploy-worker.yml` | **Off** (manual only) | Emergency deploy via Actions if needed |
| `deploy.yml` | **Off** (manual only) | Legacy duplicate deploy |
| `github-pages.yml` | **Off** (manual only) | Legacy gh-pages (site uses Worker `morshlive`) |
| `update-matches.yml` | **Off** (manual only) | Legacy match commit bot |
| `gemini-review*.yml` | **Manual only** (`workflow_dispatch`) | Gemini review — PR auto-trigger off (Actions billing locked) |

## Normal flow

1. Commit + merge to `main` on GitHub (PRs as usual).
2. **Cloudflare** receives the webhook and runs Workers Builds (not GitHub).
3. `korazero.com` updates within ~1–2 minutes.

One-time setup: connect the repo in Cloudflare Dashboard — see `docs/DEPLOY.md`.

Manual deploy from agent/local: `npm run deploy`
