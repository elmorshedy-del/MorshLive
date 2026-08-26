# scripts/ — data pipeline & ops

Node jobs that fetch external data and write `assets/data/*.json`.

## Key script

`fetch-matches.js` — runs on **every production deploy** (`npm run refresh:matches`).

Match-scoped stream wiring is `assets/data/stream-plans.json` (see `docs/STREAM-PLANS.md`). Record probe results with `scripts/apply-stream-plan-verify.mjs` — do not hand-edit verification timestamps in a second file.

Match-day binds: `npm run probe:wrappers` then, after push to `main`, `npm run confirm:stream-plan -- --match=<id> --url=<host/path>`. A git push is not live until that confirm exits 0.

`verify-channel-bindings.js` (end of `refresh:matches`) warns on shared koraplus slots but does not fail Workers Builds unless `KZ_BINDINGS_STRICT=1`. A hard fail here blocked Valencia and Madrid catalog deploys.

## Rules

- **Merge, don’t wipe** — ended matches must keep `clips[]`, `highlights.goals/full`, and banner posters from previous JSON + `highlightsIndex`.
- **CommonJS** in `*-lib.js`; ESM in `.mjs` crawlers — match the file you edit.
- Use `pairKey(home, away)` from `commentators-lib.js` for stable match keys.
- Banner window: rolling **3 calendar days** (Arabia UTC+3); merge with previous `highlights-banners.json`.
- After changing output shape, run `node scripts/fetch-matches.js` locally if network allows.

## Never

- Drop `highlightsIndex` entries for matches still in the 3-day banner window.
- Pin only a single highlight without merging prior goals/clips/full buckets.
