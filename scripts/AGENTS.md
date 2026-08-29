# scripts/ — data pipeline & ops

Node jobs that fetch external data and write `assets/data/*.json`.

## Key script

`fetch-matches.js` — local / `npm run refresh:matches:full` only. Workers Builds
`refresh:matches` skips the crawl (`lib/refresh-for-deploy.js`) so the commit
can deploy; it still starts and ends with `refuse-stale-main-deploy.mjs` so a
job whose SHA is no longer `origin/main` exits 1 and never reaches
`npx wrangler deploy`.

Match-scoped stream wiring is `assets/data/stream-plans.json` (see `docs/STREAM-PLANS.md`). Record probe results with `scripts/apply-stream-plan-verify.mjs` — do not hand-edit verification timestamps in a second file.

Match-day binds: `npm run probe:wrappers` then, after a visual scorebug check with
`npm run verify:scorebug -- --url=<url> --match=<espn-id>`, push to `main` and run
`npm run confirm:stream-plan -- --match=<id> --url=<host/path>`. A git push is not live until that confirm exits 0.

`verify:scorebug` opens exactly one allowed URL (a KoraZero `/wk/operator/` proxy URL or a
yallacuo/koralive AlbaPlayer URL), waits up to 5 seconds for video, captures one screenshot,
and prints concise diagnostics (HTTP status, video state, screenshot path, elapsed ms).
Read that screenshot directly — do not launch a computer-use browsing tour. It does **not**
auto-bind or record a verification; use `apply-stream-plan-verify.mjs` after reviewing
signals for the active match. Reusable for any match; pass the active ESPN id as `--match`.

Lock each loop to its explicitly requested ESPN id. When the user says one
match (for example Barcelona only), do not probe or edit any other fixture.
When they say today and tomorrow, `planBindLoop` lists every remaining EPL/La
Liga id in that window — still one timer and one bind pass per ESPN id.
For yallacuo/koralive, treat `iframeSrc` / Fabor changes only as reuse signals.
A full two-team scorebug is enough, but so are a few matching signals (listed
channel + venue, city, or one team). If T-15 is not 100% clear, arm **T-5**
rather than waiting until kickoff. Prefer the verified inner AlbaPlayer URL
when `/wk/operator/` returns `X-KZ-Mode: hls-embed`; see `docs/STREAM-PLANS.md`.

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
