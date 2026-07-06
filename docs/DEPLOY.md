# Deploy — GitHub code, Cloudflare runs

Code lives on **GitHub** (PRs, merges to `main`). Deploy runs on **Cloudflare Workers Builds** — not GitHub Actions — so GitHub billing cannot block production.

## Flow

```
PR → merge to main → GitHub webhook → Cloudflare Workers Builds → korazero.com
```

- You still commit and merge on GitHub as usual.
- Cloudflare pulls `main`, optionally refreshes match JSON, runs `npx wrangler deploy`.
- Zero GitHub Actions minutes for deploy.

## One-time setup (Dashboard)

1. Open [morshlive → Settings → Builds](https://dash.cloudflare.com/f06dda0c02d25976dcda319e942e432c/workers/services/view/morshlive/production/settings/builds).
2. **Connect** → GitHub → `elmorshedy-del/MorshLive`.
3. Configure:

| Setting | Value |
|---------|--------|
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run refresh:matches` |
| Deploy command | `npx wrangler deploy` |

4. Merge any commit to `main` and confirm a build appears under **Deployments**.

Full JSON spec: `config/cloudflare-workers-builds.json`

## Manual deploy (agent / local)

```bash
cp .env.example .env   # CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
npm run deploy
```

## Match data

Previously `update-matches.yml` ran every 30 minutes on GitHub Actions.

Now:

- **On each merge to main:** Cloudflare build runs `npm run refresh:matches` before deploy (fresh `today.json` on site).
- **To commit match files to git:** run `npm run refresh:matches`, commit, merge — same as any other code change.

## GitHub Actions

Deploy and match-cron workflows are **manual-only** (`workflow_dispatch`) so they never consume billing on push/schedule. See `.github/workflows/README.md`.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Merge to main, site unchanged | Connect Workers Builds (above) or run `npm run deploy` |
| `verify-deploy-token.js` fails | Token needs Workers Scripts Edit — see `config/cloudflare-api-token-scopes.json` |
| Builds API "Invalid token" | Use user-scoped token with Workers Builds Configuration Edit for API setup |
| GitHub Actions billing lock | Irrelevant for deploy once Workers Builds is connected |
