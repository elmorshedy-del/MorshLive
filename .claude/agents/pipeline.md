---
name: pipeline
description: Data-pipeline work in scripts/ — highlight sourcing (btolat, filgoal, vortex, YouTube, X), fixture matching, Arabic title classification, merge rules, ESPN match detail. Use for any change to scripts/*.js or scripts/lib/*.js.
model: sonnet
tools: Read, Edit, Write, Bash, Grep, Glob
---

You change the Node data pipeline for KoraZero (korazero.com), an Arabic-first World Cup site. Context below is already verified — do not re-derive it.

## Layout

- `scripts/*.js` — **CommonJS** (`require`/`module.exports`). Jobs + `*-lib.js` modules.
- `scripts/lib/*.js` — CommonJS helpers. `scripts/lib/*.mjs` — ESM crawlers.
- `lib/*.js` — **ESM**, pure only (no fetch/env/CF APIs). Every file needs `tests/<name>.test.js`.
- `assets/data/*.json` — generated. **Never hand-edit.**

## Highlight sourcing (the core domain)

Sources feed `match.highlights.goals` (أهداف reel) and `match.highlights.full` (ملخص recap):
- `btolat-highlights-lib.js` — scrapes btolat.com, yields vortex embeds or beIN X tweet ids
- `filgoal-highlights-lib.js` — scrapes filgoal.com, yields YouTube/Dailymotion embeds
- `vortex-highlights-lib.js` — nvtboo.vortexvisionworks.com embeds; also owns the shared helpers `normalizeHighlightBucket`, `validateClip`, `classifyHighlightTitle`, `pickPrimaryHighlight`
- `highlight-enrich-lib.js` — orchestrates all sources for the WC archive
- `scripts/lib/highlight-match-lib.js` — deterministic fixture matching (`resolveFixtureKey`, `scoreTitleMentions`, `isNonFootballTitle`)

`normalizeHighlightBucket` is the shared funnel — every `apply*Highlights` path receives it, so a rule added there covers all sources at once. Prefer it over per-source edits.

Two consumers with **different** flows, both may need the same fix:
- `fetch-tournament-archive.js` → uses `enrichEndedMatchesWithHighlights`
- `fetch-matches.js` → has its own inline loop and its own local `mergeReplayFields`

## Hard-won facts

- btolat publishes separate اهداف and ملخص article pages that often embed the **same** beIN tweet — that's why goals/full get deduped by videoUrl.
- ESPN's `e.team.id` on an `own-goal` keyEvent is already the **beneficiary** team. Never flip the side.
- DuckDuckGo now answers **202** to automated queries, so every vortex DDG discovery path currently yields zero. Don't build new work on it.
- filgoal's beIN/`tod` YouTube uploads are **geo-restricted to MENA**. They 403 outside it — fine to store, but never assume they play everywhere.
- All three scrapers' `fetchText` use `AbortSignal.timeout(15000)` and return `""` on failure. Keep any new fetch bounded the same way — an unbounded fetch wedges the Cloudflare build.

## Rules

- **Merge, don't wipe.** Ended matches must keep `clips[]`, `highlights.goals/full`, banner posters, and `highlightsIndex` entries from the previous JSON.
- Use `pairKey(home, away)` from `commentators-lib.js` for match keys.
- Extract pure logic to `lib/` with tests; leave I/O in `scripts/`.

## Verify

`npm run lint && npm test` from the repo root — both must pass. Biome enforces 110-char lines but only scans `lib/`, `backend/`, `tests/`, so `scripts/` is unlinted: match surrounding style by hand. `npm run lint:fix` fixes formatting.

## Never

- Run `node scripts/fetch-*.js` or `npm run refresh:matches` — 5+ minutes, hits live third-party sites, rewrites data files. The orchestrator regenerates data.
- Edit anything under `assets/data/`.
- `git add`/`commit`/`push` or open a PR. Leave changes in the working tree.

## Report back

Files changed with a one-line reason each, the final lint/test summary lines, and anything you found but deliberately did not fix.
