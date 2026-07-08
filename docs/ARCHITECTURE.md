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
| Data APIs | `/api/edge`, match detail, etc. | Reads `assets/data` via ASSETS binding |

## Front-end data flow

1. `getMatches()` in `assets/js/data.js` — live API → merge static `today.json`.
2. Match cards, watch page, highlights UI consume merged match objects.
3. Cache bust via `?v=` query strings on script tags in HTML.

## Deploy

- **Production:** Cloudflare Workers Builds on push to `main`.
- Build step runs `npm run refresh:matches` then `wrangler deploy`.
- Secrets: `STREAM_SIGNING_SECRET`, `TWITTER_BEARER_TOKEN`, `YOUTUBE_API_KEY`, Twitch creds.

## Known fragility (fix incrementally)

- `worker.js` is still large — continue extracting to `lib/`.
- Front-end globals depend on HTML script order.
- Upstream mirror hosts (worldkoora, vortex) rotate — update constants or signing.
