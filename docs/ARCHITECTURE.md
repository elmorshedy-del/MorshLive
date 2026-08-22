# Architecture (KoraZero)

High-level map for humans and agents. Keep `AGENTS.md` short; details live here.

## Request flow

```
Browser → korazero.com
  ├─ Static HTML/JS/CSS (Cloudflare Assets, no worker)
  └─ /wk/* /dl/* /replay/* /api/* → worker.js
```

## worker.js responsibilities

| Area | Routes | Notes |
|------|--------|-------|
| Stream proxy | `/wk/hls`, `/dl/hls`, `/sir/hls` | HMAC-signed HLS; host rotation via `STREAM_SIGNING_SECRET` |
| Replay | `/replay/embed/*`, `/replay/asset` | Vortex embed sanitizer + m3u8 rewrite (`lib/replay-hls.js`) |
| Memes | `/api/recent-memes`, `/api/match-memes` | Threshold logic in `lib/meme-threshold.js` |
| Data APIs | `/api/edge`, match detail, `/api/stream-plan` | Reads `assets/data` via ASSETS binding |

## Front-end data flow

1. `getMatches()` in `assets/js/data.js` — live API → merge static `today.json`.
2. Match cards, watch page, highlights UI consume merged match objects.
3. Cache bust via `?v=` query strings on script tags in HTML.

## Deploy

- **Production:** Cloudflare Workers Builds on push to `main`.
- Build step runs `npm run refresh:matches` then `wrangler deploy`.
- Secrets: `STREAM_SIGNING_SECRET`, `TWITTER_BEARER_TOKEN`, `YOUTUBE_API_KEY`, Twitch creds.

## Stream plans

Match-scoped playback lives in `assets/data/stream-plans.json`. Pure selection
rules are in `lib/stream-plan.js`; the worker exposes `GET /api/stream-plan`.
The watch page waits for that plan before mounting a player so the generic
embed cannot flash the wrong game. Operator workflow: `docs/STREAM-PLANS.md`.

## Known fragility (fix incrementally)

- `worker.js` is still large — continue extracting to `lib/`.
- Front-end globals depend on HTML script order.
- Upstream mirror hosts (worldkoora, vortex) rotate — update constants or signing.
- Legacy channel bindings still exist for matches without a catalog plan.
