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

`korazero.com` is the **production Worker**. PR Workers Builds only run `wrangler versions upload` and do **not** update the live site. Production Workers Builds on `main` run `npm run refresh:matches` then `npx wrangler deploy`. On Workers CI that refresh **skips the match crawl** (SEO pages from the committed `today.json` only) so a new commit is not stuck behind a multi-minute queue. A stale job whose SHA is no longer `origin/main` still exits 1 and does not deploy. Run `npm run refresh:matches:full` locally when the crawl itself is the work.

After merging user-facing HTML/JS/CSS to `main`:

1. **Curl live** — the page and the bumped `?v=` asset. Compare to `origin/main`.
2. **Still old** — **force deploy now**: `npm run deploy` (Wrangler; skips the match crawl). Do not wait for Workers Builds. Re-curl until the new markup / `?v=` is live, then tell the user to hard-refresh.
3. **Live already has the new files** — skip deploy. Hard-refresh / cache, or it is a real product bug.

Do not treat an in-flight `main` Workers Build as “good enough” while korazero.com is still serving the previous `?v=`.

## Hero images (`assets/img/*.jpg`)

The homepage heroes are **artwork the owner supplies**. They are not yours to
resize, re-encode “for performance”, or regenerate. Ship the owner's file at its
own pixel dimensions. This has gone wrong repeatedly, so the rules are explicit.

**Never**

- Downscale. `korazero-saudi.jpg` has shipped at 640×360 more than once when its
  source was far larger. If you think a hero is too heavy, say so and let the
  owner decide — do not shrink it and move on.
- Re-encode an existing hero to “optimise” it. Every pass loses more.
- Use 4:2:0 chroma subsampling. These images carry saturated text and logos, and
  4:2:0 smears their edges. Always `subsampling=0`.
- Reach for WebP here. Measured on the Saudi hero, WebP scored 37–38 dB against
  the source where JPEG q95 scored 43 dB, because the crowd and floodlight detail
  defeat its perceptual model. JPEG 4:4:4 is the right format for this artwork.

**How to replace one**

Convert from the owner's original, at its native size, in one pass:

```python
from PIL import Image
im = Image.open(SOURCE).convert("RGB")          # never .resize(...)
im.save("assets/img/<name>.jpg", "JPEG",
        quality=95, subsampling=0,               # 4:4:4, no chroma loss
        optimize=True, progressive=False)
```

Then, in the same commit:

1. Update `width`/`height` on the `<img>` in `index.html` to the **real** pixel
   size. A stale pair here is the clearest signal a hero was silently downscaled.
2. Bump the `?v=` on that `src`.

**Verify before committing** — a hero has shipped corrupt, not merely small:

```bash
python3 -c "from PIL import Image; im=Image.open('assets/img/korazero-saudi.jpg'); im.load(); print(im.size)"
ls -l assets/img/korazero-saudi.jpg
```

`im.load()` decodes the whole frame, so a truncated file raises here instead of
reaching production. `korazero-saudi.jpg` once sat on `main` at 19 KB as a
**truncated, undecodable** JPEG that browsers rendered as a part-frame. Size
alone would not have caught it. Expect a few hundred KB to ~1 MB for a hero; tens
of KB means something ate it.

**Why this keeps regressing**

Usually nothing “re-compressed” the file. `6b9aeb7 Restore full-quality Saudi
hero` put a 331 KB image on `main`, and the very next rollback to a known-good
*streaming* snapshot (`0504e4c`) restored the whole tree — reverting the hero
along with it, back to the 19 KB copy. A rollback aimed at playback silently
reverts assets too. **After any tree-wide rollback, re-check the heroes** with
the command above and restore them in a follow-up commit.

## Boundaries

**Always**

- Read nearest `AGENTS.md` (root → subfolder).
- Preserve merge behavior in `scripts/fetch-matches.js` (clips, highlights, banners).
- Bump `?v=` on changed JS/CSS in HTML when users must see updates.
- Put new `/api/*` handlers in `backend/routes/` with logic in `backend/services/`.
- Put new pure logic in `lib/` with tests.
- Treat the IPTV line's `max_connections` as an operational detail, not a design
  constraint. It is the owner's subscription and the owner's call — build and
  ship the feature, mention the limit once if it is genuinely relevant, and do
  not stall, re-litigate it, or ask whether to proceed because of it. Do keep
  automated probing off the playback path (see `assets/js/iptv-quality.js`):
  that is about not fighting the player for a slot, which is a code rule, not a
  reason to pause the work.
- Merge the PR once the work is finished and CI is green.
- After merge, curl live `korazero.com`. If it is still the old `?v=` / markup, run `npm run deploy` immediately. Do not wait for Workers Builds `refresh:matches`.
- Keep match-day binding scope explicit. If the user names one match, probe, bind, deploy, and confirm only that ESPN id; do not advance through the remaining fixture list. If they ask for **today and tomorrow**, cover remaining EPL / La Liga / Saudi Pro League in that UTC window (`lib/bind-schedule.js`): execute any fixture already inside T-15 / T-7 / kickoff, and arm one T-15 timer per later ESPN id. If the T-15 timer was missed, start that pass as soon as you can — do not wait for T-7.
- For yallacuo/koralive, prefer a verified inner AlbaPlayer `iframeSrc` through `/wk/operator/` when it returns `X-KZ-Mode: hls-embed`; otherwise keep the existing allowed-wrapper flow. Bind when a few signals already point at this match (listed channel + venue/city/one team). A 100% two-team scorebug is not required. If T-15 is still unclear, retry at **T-7**, then kickoff.

**Ask first**

- Adding/removing npm dependencies.
- Changing CI (`.github/workflows/`).
- Large `worker.js` splits or new HTML pages.

**Never**

- Commit secrets (`.env`, Wrangler tokens). Use Wrangler secrets for prod.
- Strip inline player scripts in replay embed sanitizer (breaks RadiantMP).
- Disable lint/tests to green CI — fix the cause.
- Resize, re-encode, or regenerate a homepage hero — see **Hero images** above.
  `tests/hero-images.test.js` enforces it; if that test fails, restore the
  owner's artwork rather than editing the expected size to match a shrunk file.
- Install “vibecode” prompt kits as a substitute for tests/lint.

## References

- Open standard: https://agents.md/
- Template cookbook: https://github.com/Taiizor/agents-md-cookbook
- This repo’s architecture: `docs/ARCHITECTURE.md`
- Backend layers + template repos: `docs/BACKEND.md`
