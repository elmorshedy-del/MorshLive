# KoraZero — agent guide

This repo is a **plain HTML/JS front-end** + **single Cloudflare Worker** (`worker.js`). No bundler, no React. Treat it as production infrastructure, not a throwaway prototype.

## Architecture

| Layer | Location | Notes |
|-------|----------|-------|
| Static UI | `*.html`, `assets/js/`, `assets/css/` | Globals on `window.*`; script order in HTML matters |
| Edge API + proxy | `worker.js` | Stream proxy, replay, memes, APIs — keep pure logic in `lib/` |
| Data refresh | `scripts/fetch-matches.js` | Writes `assets/data/*.json`; runs on CF Builds deploy |
| Shared pure logic | `lib/` | Imported by worker + covered by `tests/` |

## Rules for changes

1. **Minimize scope** — one bug, one focused diff. Do not refactor unrelated code.
2. **Extract before complex logic grows** — new pure functions go in `lib/`, with Vitest tests in `tests/`.
3. **Never strip replay/player scripts** in `sanitizeReplayEmbedHtml` — RadiantMP init lives in inline scripts.
4. **Preserve data on refresh** — `fetch-matches.js` must merge previous `clips`, `highlights`, banners, and `highlightsIndex`.
5. **Cache bust** — bump `?v=` on changed `assets/js` or CSS in HTML when users must see updates.
6. **Secrets** — `STREAM_SIGNING_SECRET`, `TWITTER_BEARER_TOKEN`, etc. are Wrangler secrets; features degrade silently without them.

## Verify before merge

```bash
npm run lint
npm test
npm run refresh:matches   # when touching fetch scripts or data shape
```

## Deploy

Production: **Cloudflare Workers Builds** on push to `main`. Manual: `npm run deploy`.

## What NOT to install

GitHub “vibecode” kits (e.g. vibecode-pro-max-kit) are **AI workflow prompts**, not runtime fixes. They do not replace lint, tests, or CI.
