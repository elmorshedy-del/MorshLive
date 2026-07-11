# KoraZero

A clean, **ad-free** sports streaming front-end — live match schedule, channel grid, and a watch page with HLS video playback. Arabic-first (RTL), fully responsive, dark theme.

> **No ads. No pop-ups. No trackers.**

## Features

- **Home page** — today's matches (live / upcoming / ended filters) + channel grid
- **Watch page** — HLS player (`hls.js`), server switcher, sidebar of other channels
- **Live fixtures** — auto-refreshed from TheSportsDB with ESPN scoreboard fallback via `assets/data/today.json`
- **ملخص المباريات (match summaries)** — every ended match gets an auto-generated Arabic recap (result, scorers when known, venue) plus a matched highlight clip when available — see [Match summaries](#match-summaries-ملخص-المباريات) below
- **التشكيلة الرسمية + إحصائيات المباراة (lineups + advanced stats)** — official lineups/formations pre-kickoff and 15 live/final stat categories (possession, shots, passing, tackles, etc.), sourced from ESPN — see [Lineups & stats](#lineups--advanced-stats-التشكيلة--الإحصائيات) below
- **Responsive** — mobile, tablet, desktop with collapsible nav
- **Zero build step** — plain HTML/CSS/JS

## Run locally

```bash
cd MorshLive
python3 -m http.server 8000
# open http://localhost:8000
```

Or open `index.html` in a browser (the player works best over `http://`).

## Project structure

```
index.html              # home: matches + channels
watch.html              # player page
embed-test.html         # isolated iframe embed tester
assets/
  css/styles.css        # all styles (theme, RTL, responsive)
  data/today.json       # live match fixtures (auto-updated)
  js/data.js            # channels + getMatches()
  js/app.js             # home page rendering & filters
  js/watch.js           # player, server switching, sidebar
scripts/
  fetch-matches.js      # pulls fixtures from TheSportsDB + ESPN fallback
.github/workflows/
  update-matches.yml    # manual only — match refresh via CF Builds or npm run refresh:matches
```

## Adding channels

Edit **`assets/js/data.js`**. Example:

```js
{ id: "my-channel", name: "My Channel", group: "Sports",
  quality: "1080p", stream: "https://example.com/your-licensed-stream.m3u8", badge: "HD" }
```

Matches reference a channel by `channelId`.

## Refresh match data manually

```bash
node scripts/fetch-matches.js          # today (UTC)
node scripts/fetch-matches.js 2026-06-20 # specific date
```

## Match summaries (ملخص المباريات)

`scripts/fetch-matches.js` (run on the same 30-minute cron as the fixtures)
attaches, for every match that has ended:

- **`summaryAr`** — a templated Arabic recap (winner/draw, final score, venue,
  commentator) built entirely from data already in the fixture. Always present,
  no extra setup or external call required.
- **`highlight`** — an **Arabic-commentary** highlights video, found via a
  targeted YouTube search (`ملخص وأهداف مباراة <الفريق> و<الفريق> تعليق عربي`)
  when a free `YOUTUBE_API_KEY` is configured. A result is only kept if its
  title/description is actually in Arabic script — a highlight clip with
  English or no commentary is treated the same as no clip at all, since
  Arabic commentary is the whole point. The embed URL is built from a
  validated YouTube video id, never from a raw URL in the API response.

Both fields ride along in `assets/data/today.json` per match plus a
`highlightsIndex` (same join pattern as `commentaryIndex`), so the summary and
clip also show up when the browser is using the live TheSportsDB/ESPN fetch
instead of the cached file. They render as a collapsible "ملخص المباراة"
panel on ended match cards on the home page, and a static panel on the watch
page for that match. Once a match has a matched clip it's pinned in
`highlightsIndex` and never re-queried, so a full day of World Cup fixtures
stays well inside YouTube Data API's free quota (100 units/search, 10,000/day).

To enable highlight clips: create a free API key with the **YouTube Data
API v3** enabled in the [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
and add it as the `YOUTUBE_API_KEY` repository secret (GitHub → Settings →
Secrets). Without a key the site still ships the Arabic text summary for
every match — only the video clip is skipped.

## Lineups & advanced stats (التشكيلة + الإحصائيات)

Also attached by `scripts/fetch-matches.js`, from ESPN's free site API — the
same source already used for scores/fixtures, so there's no second, less
trusted data source involved:

- **`lineups`** — rendered as a green pitch per team, players positioned by
  tactical band (goalkeeper / defense / midfield / attack, derived from ESPN's
  own position data, not a numeric-slot guess). Reflects who is *currently* on
  the pitch: a starter replaced in a substitution event (from ESPN's
  play-by-play `keyEvents`) is swapped for whoever came on, tagged with who
  they replaced and the minute; a player with a yellow/red card shows a card
  badge. Substitutes not yet used stay in a collapsible bench list. Appears
  once ESPN publishes the lineup, typically shortly before kickoff.
- **`stats`** — 15 curated stat categories per team (possession, shots, shots
  on target, corners, fouls, cards, passes + accuracy, tackles, interceptions,
  clearances, crosses, saves), shown as a mirrored comparison bar per stat.
  Populates once the match is live and updates with each 30-minute refresh.

**Update cadence:** both fields (cards and substitutions included) refresh on
the same 30-minute `fetch-matches.js` cron as everything else — not
second-by-second. A card or sub can take up to ~30 minutes to appear on the
pitch, the same latency the stats panel already has.

**Coverage note:** this only works for matches whose id encodes an ESPN event
(`espn-<league>-<id>`, from `normalizeEspnEvent`). Fixtures that only came
from TheSportsDB have no ESPN event to query, so they simply show no lineups/
stats panel — never a guess or a fallback to a less reliable source. No API
key is needed; ESPN's site API is free and unauthenticated.

Both fields ride along per match in `assets/data/today.json` plus a
`matchDetailIndex` (same join pattern as `commentaryIndex`/`highlightsIndex`)
so they also show up when the browser is using the live fetch path. They
render as collapsible panels ("التشكيلة الرسمية" / "إحصائيات المباراة") on
home page match cards, and as static panels directly below the video player
on the watch page.


## Authorized Xtream IPTV importer

MorshLive can import live-channel metadata from your own authorized Xtream Codes portals without committing credentials to GitHub. Store the portal export as a Cloudflare Worker secret:

```bash
npx wrangler secret put XTREAM_PORTALS_JSON
```

Paste JSON in this shape when prompted:

```json
{
  "portals": [
    { "url": "http://example.com:8080", "username": "...", "password": "...", "label": "Primary" }
  ]
}
```

Available same-origin endpoints:

- `GET /api/xtream/status` — verifies each configured portal and returns masked account status.
- `GET /api/xtream/categories` — returns sanitized live-TV categories.
- `GET /api/xtream/live?limit=1000` — returns sanitized live-channel metadata plus encrypted temporary HLS and MPEG-TS playback URLs. Optional filters: `portal=p1`, `category=<id-or-name>`, `q=<search>`, `stream=<id>`.
- `GET|HEAD /api/xtream/media/<token>` — validates the encrypted token, fetches the authorized stream server-side, and rewrites HLS manifests so credentials never appear in browser-visible URLs.

Open `iptv-admin.html` to search, preview, and send a channel to the existing `watch.html` player. The watch URL carries only portal and stream identifiers; it fetches a fresh encrypted playback token when loaded.

The API never returns usernames, passwords, or raw portal credentials to the browser. Media tokens use `XTREAM_TOKEN_SECRET` when configured, otherwise the existing `STREAM_SIGNING_SECRET`.

## Deploy (korazero + Cloudflare)

**Merge to `main` on GitHub → Cloudflare Workers Builds deploys** (no GitHub Actions billing).

Full guides: **[docs/DEPLOY.md](docs/DEPLOY.md)** · **[docs/CLOUDFLARE.md](docs/CLOUDFLARE.md)**

| Method | How |
|--------|-----|
| **Production (default)** | Merge PR to `main` → [Workers Builds](config/cloudflare-workers-builds.json) on Cloudflare |
| Agent / local | `npm run deploy` (needs `.env` with `CLOUDFLARE_API_TOKEN`) |
| Emergency | GitHub Actions → Deploy Worker → Run workflow (manual only) |

**Never** put the API token in website code.

Target URLs:

- `https://korazero.com`
- `https://korazero.com/watch/bein-sports-1`

## Streams & legality

Bundled `stream` URLs are **free public demo HLS feeds** (Mux / Apple test streams). This project is a **front-end template** only.

To run real channels, supply your own **legally licensed** stream URLs. Rebroadcasting paid sports channels without a license is illegal in most countries.
