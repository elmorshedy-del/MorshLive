# lib/ — shared pure modules

Extract **testable, side-effect-free** logic here. `worker.js` imports these modules; `tests/` covers them.

## Rules

- No `fetch`, no `env`, no Cloudflare APIs — keep functions pure or inject dependencies.
- Export named functions only; one concern per file (`meme-threshold.js`, `replay-hls.js`).
- Every new file needs tests in `tests/<name>.test.js`.
- Run `npm test` after changes.

## When to extract from worker.js

Extract when logic is:
- Used in more than one place, or
- Bug-prone (HLS URL rewrite, threshold math, date windows), or
- Longer than ~40 lines of pure transforms

Leave in `worker.js`: routing, fetch handlers, HTML sanitizers tied to worker constants.
