# Stream plans

One match → one plan → one playable source. That is the repeatable path after a
World Cup of per-match hotfixes, channel swaps, and sandbox/referrer guesses.

The watch page **does not** mount the generic KoraPlus iframe until a plan is
known. If the plan says wait or conflict, the player stays on a holding state
instead of flashing the wrong game.

## What you paste

You provide a working link or embed for a **specific match**. Put it in
`assets/data/stream-plans.json`. The worker turns that file into
`GET /api/stream-plan?match=<id>`. The watch page consumes that response before
it touches the player.

Do **not** put IPTV usernames, passwords, or portal admin URLs in this file.
Xtream credentials stay in Wrangler secrets. A plan only stores `portalId` +
`streamId`.

```json
{
  "version": 1,
  "updatedAt": "2026-08-22T16:00:00.000Z",
  "plans": [
    {
      "matchId": "espn-eng.1-401111111",
      "teams": [["liverpool", "lfc"], "arsenal"],
      "contentKey": "bein-sports-1",
      "kickoffUtc": "2026-08-22T19:00:00Z",
      "policy": {
        "sameContentOnly": true,
        "allowAutoHeal": false,
        "allowUnverifiedFallback": false,
        "allowLegacy": false
      },
      "sources": [
        {
          "id": "primary",
          "role": "primary",
          "kind": "iframe",
          "profile": "operator-iframe-v1",
          "url": "https://example.invalid/embed/this-match",
          "contentKey": "bein-sports-1",
          "status": "operator",
          "label": "Operator embed"
        }
      ]
    }
  ]
}
```

`teams` is a fallback when the ESPN id is not known yet. Each side can be a
string or a list of aliases. Matching is exact after normalization — no
substrings.

## The checklist (every match)

1. Identify the match: ESPN id from `today.json`, or home/away names.
2. Assign a **content key** for the actual feed (`bein-sports-1`, `bein-max-2`,
   `iptv:bein1`). Two live matches must never share a content key.
3. Paste the working embed, HLS URL, or Xtream `portalId`/`streamId`.
4. Pick a **provider profile** (sandbox + referrer are frozen there).
5. Leave `status` as `operator` until a probe succeeds.
6. Set `allowLegacy: false` so the site will not silently fall back to the
   generic 24/7 embed.
7. Commit the JSON. The watch page waits for `/api/stream-plan` and plays only
   the selected source.
8. Before kickoff, verify the primary source and record the result:

```bash
node scripts/apply-stream-plan-verify.mjs --match=espn-eng.1-401111111 --source=primary --ok
# or
node scripts/apply-stream-plan-verify.mjs --match=espn-eng.1-401111111 --source=primary --fail --note="blank iframe"
```

Existing Playwright work (`npm run verify:prekickoff`) stays the probe. This
script is the write-back so the catalog, not a chat thread, remembers what
worked.

## Statuses

| Status | Meaning | Player |
| --- | --- | --- |
| `verified` | Probe confirmed this source, same content | Play it |
| `operator` | You pasted it; not probed yet | Play it (trusted input) |
| `pending` | Known candidate, not trusted | Held unless `allowUnverifiedFallback` |
| `failed` | Probe failed | Never used as a fallback |
| `waiting` | Catalog plan exists but nothing playable | Hold — no default flash |
| `conflict` | Two live catalog plans share a content key | Hold both |
| `legacy` | No catalog row; generic channel embed | Play only after the match is known |

Expired `verified` / `operator` rows (`expiresAt` in the past) demote to
`pending` automatically.

## Provider profiles (sandbox + referrer)

These used to be guessed in `watch.js` per incident. They now live in
`lib/stream-plan.js` as versioned profiles.

| Profile | Kind | Sandbox | When to use |
| --- | --- | --- | --- |
| `operator-iframe-v1` | iframe | none | Default for a pasted embed |
| `operator-hls-v1` | hls | n/a | Pasted `.m3u8` |
| `koraplus-v1` | iframe | none | go4score / frame.php (iOS breaks inside sandbox) |
| `kooracity-v1` | iframe | none | Nested wrappers inherit sandbox |
| `ntv-v1` | iframe | none | Same as Koora City |
| `sirtv-v1` | iframe | scripts + same-origin | Same-origin worker proxy |
| `xtream-v1` | xtream | n/a | Your IPTV portal stream id |
| `hls-direct-v1` | hls | n/a | Worker-signed or CORS HLS |

If a host later needs a different referrer or sandbox, **add a v2 profile**.
Do not edit v1 in place — old verified rows keep the policy they were tested
with.

`allowAutoHeal` defaults to false. Auto-heal is what swapped a match onto a
generic 24/7 channel during the World Cup. Same-content `fallbackUrl` on an
HLS source is allowed; switching to a different content key is not.

## IPTV you own

The site already proxies Xtream Codes portals (`/api/xtream/*`, `iptv-admin.html`).
To bind a portal channel to a match:

1. Store portal URL / username / password as Wrangler secrets
   (`XTREAM_PORTALS_JSON`). Never commit them.
2. Confirm the channel in `iptv-admin.html`.
3. Add an `xtream` source to the match plan:

```json
{
  "id": "iptv-bein1",
  "role": "primary",
  "kind": "xtream",
  "profile": "xtream-v1",
  "portalId": "primary",
  "streamId": "1234",
  "contentKey": "bein-sports-1",
  "status": "operator"
}
```

The watch page fetches the signed playback URL from the worker. The browser
never sees portal credentials.

## Scheduled verification

Recommended loop, outside GitHub Actions (Playwright is too heavy for Actions):

1. `T-45min` — `npm run verify:prekickoff -- --match=<id>`
2. Write the probe into the catalog with `apply-stream-plan-verify.mjs`
3. Deploy or let the next build publish `stream-plans.json`
4. Watch page serves `verified` until `expiresAt`

If the probe fails, mark `--fail` and leave `allowLegacy: false`. The player
holds. That is better than a silent wrong match.

## Match-day bind loop (lesson from 23 Aug 2026)

Cloudflare Workers Builds runs `npm run refresh:matches` **before**
`npx wrangler deploy`. That crawl is slow. A catalog commit on `main` can sit
unpublished for several minutes. Until then
`GET /api/stream-plan?match=<id>` returns `no-catalog-legacy` and the watch
page mounts a blank koraplus player. That is what “nothing” looked like for
Elche–Barcelona.

Do this for every remaining fixture:

1. **T-15** — `npm run probe:wrappers`. If no scorebug for this match, stop
   the visual tour. Arm a **kickoff** one-shot. Do not bind a studio, FT
   graphic, or another league.
2. **Kickoff** — probe again. A new inner Fabor id on a slot is the reuse
   signal. Confirm the scorebug (2 URLs max: the likely BeIN slot + its
   yallacuo twin). Bind only `mo.yallacuo.xyz/albaplayer/…` or
   `pl.koralive1.cc/albaplayer/…`.
3. **Never** bind `reddit-soccer-streams.online`, `iframe.st`,
   `kora-plus.li` / `kora-plus.app`, or a go4score **listing** page.
4. **Never** steal a slot from a still-live catalog match.
5. Write `stream-plans.json` (`contentKey: match:<espn-id>`), commit, push,
   merge to `main`.
6. **Not live yet.** Run:

   ```bash
   npm run confirm:stream-plan -- --match=espn-esp.1-401882913 --url=yallacuo.xyz/albaplayer/sport-2
   ```

   Poll until `catalog: true` and the playback URL is the wrapper you bound.
   Only then tell the user to hard-refresh. If confirm times out, say
   production has not deployed — do not claim the bind is on the site.

If a match has no Arabic wrapper after kickoff (Getafe–Racing that Sunday),
leave it unbound. A hold is better than the wrong game.

## What this replaces, and what it does not

The catalog is the new authority for matches you have actually wired.

Still in place, as fallbacks only:

- `channel-bindings.json` — default embed per beIN channel
- `stream-routes.json` — crawled wrapper URLs for the worker
- Hardcoded pins in `watch.js` / `psg-live-hotfix.js` — last-resort World Cup locks

A verified or operator plan wins over those. A waiting/conflict plan wins over
the generic embed. Hardcoded pins still win over a *legacy* plan so existing
locks keep working until they are moved into the catalog.
