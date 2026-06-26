# KoraZero code review style guide (Gemini)

## Stream routing (critical)

- Only two real embed feeds exist: `vip1` and `vip2` at `vip.worldkoora.com`
- `assets/data/channel-bindings.json` is the source of truth; sync to `assets/js/channel-bindings.js`
- `EMBED_BINDING` maps `bein-max-N` → `vip1` or `vip2` — calibration changes when upstream swaps feeds
- Player 2 VIP **must** use the same embed URL as Player 1 for the selected channel (`channel.embed`), never a hardcoded `vip1`

## Watch page

- `resolveWatchSelection`: when `?match=ID` is present, that match's `channelId` always wins
- Lazy-load Player 2 iframe until selected (save bandwidth)
- Do not auto-switch embed servers mid-playback in `stream-check.js` (`data-kind="reachable"`)

## Deploy

- Static site on Cloudflare Worker `morshlive` with `[assets]` in `wrangler.toml`
- Do not commit API tokens; use `.env` (gitignored) or GitHub Secrets

## JavaScript

- Match existing IIFE style in `assets/js/`
- Parenthesize mixed `&&` and `||` conditions explicitly
- Bump `?v=` cache-bust on HTML script tags when changing JS/CSS
