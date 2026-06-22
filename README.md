# MorshLive

A clean, **ad-free** sports streaming front-end — live match schedule, channel grid, and a watch page with HLS video playback. Arabic-first (RTL), fully responsive, dark theme.

> **No ads. No pop-ups. No trackers.**

## Features

- **Home page** — today's matches (live / upcoming / ended filters) + channel grid
- **Watch page** — HLS player (`hls.js`), server switcher, sidebar of other channels
- **Live fixtures** — auto-refreshed from TheSportsDB via `assets/data/today.json`
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
  fetch-matches.js      # pulls fixtures from TheSportsDB
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
