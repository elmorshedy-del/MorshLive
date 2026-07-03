# KoraZero

A clean, **ad-free** sports streaming front-end — live match schedule, channel grid, and a watch page with HLS video playback. Arabic-first (RTL), fully responsive, dark theme.

> **No ads. No pop-ups. No trackers.**

## Features

- **Home page** — today's matches (live / upcoming / ended filters) + channel grid
- **Watch page** — HLS player (`hls.js`), server switcher, sidebar of other channels
- **Live fixtures** — auto-refreshed from TheSportsDB with ESPN scoreboard fallback via `assets/data/today.json`
- **ملخص المباريات (match summaries)** — every ended match gets an auto-generated Arabic recap (result, scorers when known, venue) plus a matched highlight clip when available — see [Match summaries](#match-summaries-ملخص-المباريات) below
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
  update-matches.yml    # refreshes today.json on a schedule
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

## Deploy (korazero + Cloudflare)

Full guide: **[docs/CLOUDFLARE.md](docs/CLOUDFLARE.md)**

**Where your Cloudflare API goes:**

| Method | Put token here |
|--------|----------------|
| Cloudflare Git connect | Nowhere — use dashboard OAuth |
| GitHub Actions deploy | GitHub → **Settings → Secrets** → `CLOUDFLARE_API_TOKEN` |
| Local `wrangler` deploy | `.env` file (copy from `.env.example`) |

**Never** put the API token in website code.

Target URLs:

- `https://korazero.com`
- `https://korazero.com/watch/bein-sports-1`

## Streams & legality

Bundled `stream` URLs are **free public demo HLS feeds** (Mux / Apple test streams). This project is a **front-end template** only.

To run real channels, supply your own **legally licensed** stream URLs. Rebroadcasting paid sports channels without a license is illegal in most countries.
