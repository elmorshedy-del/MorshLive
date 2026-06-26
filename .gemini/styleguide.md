# KoraZero code review style guide (Gemini)

## Stream routing (critical)

- Only two real embed feeds exist: `vip1` and `vip2` at `vip.worldkoora.com` — generic wrappers, not fixed beIN channels
- `vip1`/`vip2` pages embed upstream slugs like `beinmax1`/`beinmax2` (often inverted vs slot name)
- `scripts/channel-bindings-lib.js` probes vip slots at fetch time; each match gets `embedKey` in `today.json`
- `assets/data/channel-bindings.json` stores `vipSlotProbe` + fallback `embedBinding`; sync to `assets/js/channel-bindings.js`
- Browser: `resolveWatchSelection` → `match.embedKey` from fetch, then `vipSlotProbe`, then static `embedBinding`
- Playback always uses the worldkoora vip wrapper URL for the resolved `embedKey` — do not iframe syria-player directly
- Player 2 VIP **must** use the same resolved embed URL as Player 1 (`picked.embed` / `activeEmbed`), never a hardcoded `vip1`

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
