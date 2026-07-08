# scripts/ — data pipeline & ops

Node jobs that fetch external data and write `assets/data/*.json`.

## Key script

`fetch-matches.js` — runs on **every production deploy** (`npm run refresh:matches`).

## Rules

- **Merge, don’t wipe** — ended matches must keep `clips[]`, `highlights.goals/full`, and banner posters from previous JSON + `highlightsIndex`.
- **CommonJS** in `*-lib.js`; ESM in `.mjs` crawlers — match the file you edit.
- Use `pairKey(home, away)` from `commentators-lib.js` for stable match keys.
- Banner window: rolling **3 calendar days** (Arabia UTC+3); merge with previous `highlights-banners.json`.
- After changing output shape, run `node scripts/fetch-matches.js` locally if network allows.

## Never

- Drop `highlightsIndex` entries for matches still in the 3-day banner window.
- Pin only a single highlight without merging prior goals/clips/full buckets.
