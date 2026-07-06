# KoraZero / MorshLive — architecture map

**Read this before any task.** Covers how the static site, Cloudflare Worker, data pipeline, streams, and memes connect.

## Cloudflare topology

```
GitHub (elmorshedy-del/MorshLive)
    │
    ├─ push main ──► Cloudflare Workers Builds ──► wrangler deploy
    │
    └─ agent/local ──► npm run deploy (.env CLOUDFLARE_API_TOKEN)

Production
    Worker name: morshlive
    Domains:     korazero.com/* , www.korazero.com/*
    Binding:     env.ASSETS → entire repo (static HTML/JS/JSON + worker.js)
    Secrets:     STREAM_SIGNING_SECRET, TWITTER_BEARER_TOKEN, TWITCH_*, YOUTUBE_API_KEY, …
```

| Layer | What runs | Where |
|-------|-----------|--------|
| Edge | `worker.js` `fetch()` router | Cloudflare Worker `morshlive` |
| Static | HTML, CSS, JS, JSON under `/assets/` | Same Worker via `[assets]` binding |
| Cron/data | `scripts/fetch-matches.js`, `fetch-tournament-archive.js` | Workers Builds on merge, or manual `npm run refresh:matches` |

There is **no separate Pages deploy** for korazero.com — one Worker serves everything.

---

## Frontend pages

| Page | Entry | Main JS | Purpose |
|------|-------|---------|---------|
| Home | `index.html` | `app.js`, `data.js`, `recent-tweets.js` | Live cards, schedule, X meme rail, highlights |
| Watch | `watch.html` | `watch.js`, `stream-check.js` | Single iframe player, channel/server pickers |
| Tournament archive | `tournament.html` | `tournament.js` | Ended matches, ملخص video, static memes from archive JSON |
| Search | `search.html` | `search.js` | Match search |
| Streams lab | `bein-lab.html` | `streams-lab.js` | Experimental 24/7 beIN sources |

Shared: `i18n.js` (AR/EN), `channel-bindings.js` (embed routing), `tweet-cards.js` (X media UI).

---

## Data files (generated vs hand-edited)

| File | Updated by | Used by |
|------|------------|---------|
| `assets/data/today.json` | `scripts/fetch-matches.js` | Home, watch, worker live APIs |
| `assets/data/live-snapshot.json` | `channel-bindings-lib.js` during fetch-matches | Ops/debug routing |
| `assets/data/channel-bindings.json` | Hand-edited + synced to `.js` | `embedKeyFor()` — which VIP slot per beIN channel |
| `assets/data/match-memes.json` | `fetch-tournament-archive.js` (ended matches) | Worker `/api/match-memes`, home rail seed |
| `assets/data/meme-sources.json` | Hand-edited | @TrollFootball, @Contxtfootball, @memesvsfootball |
| `assets/data/match-notice.json` | Hand-edited | Apology/incident banners |
| `assets/data/tournament-archive.json` | `fetch-tournament-archive.js` | Tournament page |
| `assets/data/match-poll.json` | `fetch-matches.js` | Watch page polls |

---

## Stream routing (do not change during live games without ops reason)

```
watch.js
  └─ embedUrlFor(embed) → /wk/albaplayer/{vip1|vip2|amine|weshan|sirtv}/?ch=&match=&serv=
       │
       ▼
worker.js proxy routes
  /wk/albaplayer/vip1|vip2  → proxyVip → worldkoora (mysportv.live) HTML → extract HLS → cleanHlsPlayerHtml
  /wk/albaplayer/sirtv      → proxySirTv → shootsync Sir TV page → HLS proxy (TEMP Portugal)
  /wk/albaplayer/amine      → proxyAmine
  /wk/albaplayer/weshan     → proxyWeshan
  /wk/hls?u=&sig=           → proxyHls (signed, any CDN host)
  /dl/{id}                  → proxyDlEmbed → dlhd.pk 24/7
  /dl/hls?u=&sig=           → proxyDlHls
  /sir/{ar1|ar2|fr|en}      → proxySirEmbed (experimental)
```

**Binding:** `channel-bindings.json` `embedBinding` maps `bein-max-1` → `vip1` etc.  
**Match override:** `data.js` `DIRECT_MATCH_STREAMS` can pin one match (e.g. Portugal) to a single source and hide pickers.

**Player:** `cleanHlsPlayerHtml()` in worker — hls.js with mirror failover + stall recovery (`HLS_BOOT_FN`).

---

## Meme / X pipeline (common “never updated” bugs)

### Sources
- 3 accounts in `meme-sources.json`
- Syndication (no API): `syndication.twitter.com/srv/timeline-profile/…`
- Twitter API v2 (Worker secret `TWITTER_BEARER_TOKEN`): user timeline search

### Runtime (live / during tournament)

```
Home #recent-tweets
  recent-tweets.js  every 3 min
    GET /api/recent-memes
      worker proxyRecentMemesApi
        1. today.json → recent + LIVE match keys
        2. Syndication scan per live/recent match
        3. Twitter API if bearer set (always re-fetch, not skip-if-one-exists)
        4. Sort by postedAt (newest first), then engagement
        5. filterMemesWithMedia → tweet-cards rail
```

**Cache rules (after fix):**
- If **any match is `status: "live"`** → rescan every **2 min**, edge cache **2 min**
- Otherwise → rescan every **10 min**, edge cache **10 min**
- `?live=1` forces bypass

### Static archive (post-match)

```
npm run refresh:matches
  └─ fetch-tournament-archive.js
       └─ discoverLatestHighlightMemes() — only ENDED matches with ملخص, max 6
       └─ writes match-memes.json + tournament-archive.json
```

Memes for a match **do not** land in `match-memes.json` until the match ends and archive refresh runs — unless runtime API already found them.

### Per-match API

`GET /api/match-memes?home=&away=&kickoff=` — tournament cards, merges archive + live syndication + API.

---

## Key worker API routes

| Route | Purpose |
|-------|---------|
| `/api/matches/live` | Live scoreboard supplement |
| `/api/recent-memes` | Home X rail (24h window) |
| `/api/match-memes` | Per-match memes |
| `/api/x-media` | Proxy X images/video for inline playback |
| `/api/poll/{id}` | Match polls |
| `/api/twitch` | Twitch discovery |
| `/replay/embed/...` | Vortex replay + adblock |

---

## Deploy checklist

1. Read this file + `agent.md`
2. Branch `cursor/<name>-f540`
3. Bump `?v=` cache-bust on changed JS/CSS in HTML
4. `npm run deploy` or merge → Workers Builds
5. PR + Gemini poll per `agent.md`

---

## Quick debug commands

```bash
# Recent memes (force fresh scan)
curl -s "https://korazero.com/api/recent-memes?live=1" | jq '.count, .memes[0].matchKey'

# Per-match memes
curl -s "https://korazero.com/api/match-memes?home=Portugal&away=Spain&kickoff=2026-07-06T19:00Z"

# Sir TV / stream player HTML
curl -s "https://korazero.com/wk/albaplayer/sirtv/" | rg "data-kz-src"

# Refresh all JSON data locally
npm run refresh:matches
```
