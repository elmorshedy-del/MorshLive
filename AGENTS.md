# AGENTS.md

KoraZero — Arabic-first sports streaming site (plain HTML/JS + Cloudflare Worker). Production site: korazero.com.

## Stack

- **Front-end:** static HTML, vanilla JS (`assets/js/`), CSS. No bundler, no React.
- **Edge:** Cloudflare Worker (`worker.js` → `backend/` + `lib/`). Wrangler deploy.
- **Data:** Node scripts (`scripts/`) write JSON to `assets/data/`. Runs on CF Builds via `npm run refresh:matches`.
- **Node 22**, npm, Vitest, Biome.

## Commands

Run from repo root. Agents may execute these — they must work as-is.

```bash
npm install              # install dependencies
npm test                 # vitest — must pass before merge
npm run lint             # biome check lib/ backend/ tests/
npm run refresh:matches  # regenerate today.json + banners (needs network)
npm run deploy           # manual wrangler deploy (CI deploys on push to main)
```

## Code style

- **Minimize scope** — one bug, one focused diff. No drive-by refactors.
- **Match existing style** — IIFEs + `window.*` globals on front-end; ESM in worker.
- **New `/api/*` routes → `backend/routes/`** — not inline in `worker.js`.
- **Pure logic → `lib/`** — import from worker/backend; add Vitest tests in `tests/`.
- **Biome** is the linter for `lib/`, `backend/`, and `tests/`.

## Testing

- A change touching `lib/` is done when `npm run lint && npm test` pass.
- Add a failing test first for bug fixes in extractable logic.
- No unit tests yet for full `worker.js` or browser UI — use targeted tests for pure functions.

## Project structure

| Path | Purpose |
|------|---------|
| `*.html`, `assets/js/`, `assets/css/` | Front-end (script load order in HTML matters) |
| `worker.js` | Worker entry; stream/replay legacy — shrink over time |
| `docs/BACKEND.md` | Layered backend guide + GitHub template references |
| `backend/` | Edge API layers (routes → services → adapters) — see `backend/AGENTS.md` |
| `lib/` | Shared pure modules (worker + tests) — see `lib/AGENTS.md` |
| `scripts/` | Fetch/crawl jobs — see `scripts/AGENTS.md` |
| `assets/data/*.json` | Generated cache (do not hand-edit without reason) |
| `tests/` | Vitest suite |
| `docs/ARCHITECTURE.md` | Deeper architecture notes |

## Git workflow

- Branch from `main`: `cursor/<name>-f540`
- Small commits; imperative subject (`Fix replay m3u8 rewrite`).
- Before push: `npm run lint && npm test`
- When a PR is finished (requested work done, lint/tests pass, CI green), **merge it**. Do not leave finished PRs open for the user to merge.

## Production freshness

`korazero.com` is the **production Worker**. PR Workers Builds only run `wrangler versions upload` and do **not** update the live site. Production Workers Builds on `main` run `npm run refresh:matches` first, which can take several minutes before `npx wrangler deploy`. That crawl now exits 1 if `origin/main` moved, so a stale build cannot overwrite a newer wrangler deploy.

After merging user-facing HTML/JS/CSS to `main`:

1. **Curl live** — the page and the bumped `?v=` asset. Compare to `origin/main`.
2. **Still old** — **force deploy now**: `npm run deploy` (Wrangler; skips the match crawl). Do not wait for Workers Builds. Re-curl until the new markup / `?v=` is live, then tell the user to hard-refresh.
3. **Live already has the new files** — skip deploy. Hard-refresh / cache, or it is a real product bug.

Do not treat an in-flight `main` Workers Build as “good enough” while korazero.com is still serving the previous `?v=`.

## Boundaries

**Always**

- Read nearest `AGENTS.md` (root → subfolder).
- Preserve merge behavior in `scripts/fetch-matches.js` (clips, highlights, banners).
- Bump `?v=` on changed JS/CSS in HTML when users must see updates.
- Put new `/api/*` handlers in `backend/routes/` with logic in `backend/services/`.
- Put new pure logic in `lib/` with tests.
- Merge the PR once the work is finished and CI is green.
- After merge, curl live `korazero.com`. If it is still the old `?v=` / markup, run `npm run deploy` immediately. Do not wait for Workers Builds `refresh:matches`.
- Keep match-day binding scope explicit. If the user names one match, probe, bind, deploy, and confirm only that ESPN id; do not advance through the remaining fixture list.
- For yallacuo/koralive, prefer a verified inner AlbaPlayer `iframeSrc` through `/wk/operator/` when it returns `X-KZ-Mode: hls-embed`; otherwise keep the existing allowed-wrapper flow. Bind when a few signals already point at this match (listed channel + venue/city/one team). A 100% two-team scorebug is not required. If T-15 is still unclear, retry at **T-5**, then kickoff.

**Ask first**

- Adding/removing npm dependencies.
- Changing CI (`.github/workflows/`).
- Large `worker.js` splits or new HTML pages.

**Never**

- Commit secrets (`.env`, Wrangler tokens). Use Wrangler secrets for prod.
- Strip inline player scripts in replay embed sanitizer (breaks RadiantMP).
- Disable lint/tests to green CI — fix the cause.
- Install “vibecode” prompt kits as a substitute for tests/lint.

## References

- Open standard: https://agents.md/
- Template cookbook: https://github.com/Taiizor/agents-md-cookbook
- This repo’s architecture: `docs/ARCHITECTURE.md`
- Backend layers + template repos: `docs/BACKEND.md`
