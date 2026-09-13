# KNOWN GOOD — 2026-09-13 04:46 UTC

**Playback confirmed working by the owner at this exact state.** This is the
restore point. If playback breaks again, come back to everything on this page
before diagnosing anything new.

This state ended the drain that ran from roughly Sep 11 to Sep 13.

## What is running

| | |
|---|---|
| `main` | `1346ab3c7dbbb6ff5e4d57dc8e61b026ae0e77e6` |
| Worker | `morshlive` |
| Deployment | `6cda3a7d-9fed-4523-8743-172bd5f05a19` |
| Version | `1144d14c-f83f-4d50-82af-0120dd3a1db8` |
| Deployed | 2026-09-13T04:46:41Z, by Workers Builds from `main` |
| Stream Lock | 34/34 at `8fe04a34` + THMANYAH-RESOLVER-1 + XTREAM-IDLE-WATCHDOG-1 + MEDIA-URL-LEECH-1 |

## Four things hold this state up

Three of them are **not in git**. A rollback of the repository does not restore
them, and a fresh deploy does not recreate them.

1. **Worker secret `XTREAM_TOKEN_SECRET`** — set 2026-09-13 ~04:26 UTC. It did
   not exist before. It takes precedence over `STREAM_SIGNING_SECRET` for
   `/api/xtream/media` tokens only; `/wk/hls` signing is untouched. Deleting it
   silently falls back to the old key and re-validates every URL that was
   scraped before this date. **Do not delete it.** Rotating it to a new random
   value is always safe.
2. **Cloudflare IP Access Rule `aa3191d3ce104b98a586f6f73e32e994`** — blocks
   `80.155.183.76` account-wide. That client pulled 5.21GB across 46 requests in
   six hours while real viewers and IPTV Lab drained behind it. Removing this
   rule re-opens the drain.
3. **Same-origin gate** on `/api/iptv-lab/{live,channel,probe}` and **30-minute**
   media token TTL — in git, `MEDIA-URL-LEECH-1`.
4. **`assets/data/today.json` naming only channels the site can route** — the
   Thmanyah resolver is back in `lib/xtream-channel-map.js`
   (THMANYAH-RESOLVER-1), so Saudi ids resolve again.

## Restoring this exact state

```bash
git checkout -B restore-known-good 1346ab3c7dbbb6ff5e4d57dc8e61b026ae0e77e6
node scripts/verify-stream-lock.mjs     # must print 34/34
```

Then confirm the three out-of-git items above are still in place — the secret
exists, the IP rule exists, and the deployed version is this one or a descendant
of it. Cloudflare can also roll the worker straight back to version
`1144d14c-f83f-4d50-82af-0120dd3a1db8` from the Deployments tab.

## Before changing anything on the playback path

1. Read `docs/STREAM-LOCK.md` and `docs/HANDOVER-STREAM-DRAIN.md` first.
2. `node scripts/verify-stream-lock.mjs` before and after.
3. Record the new state here, with the same four items, only **after** the owner
   confirms playback still works. A green build is not confirmation.

## Verifying it is still healthy

```bash
# Is the line's slot free? (with nothing playing)
curl -s https://korazero.com/api/iptv-lab/status | grep -o '"activeConnections":"[0-9]*"'

# Is the gate live? Expect 403, then 200.
curl -s -o /dev/null -w '%{http_code}\n' 'https://korazero.com/api/iptv-lab/live?stream=2443&limit=1'
curl -s -o /dev/null -w '%{http_code}\n' -H 'Referer: https://korazero.com/watch.html' \
  'https://korazero.com/api/iptv-lab/live?stream=2443&limit=1'
```

The number worth watching is **bytes on `/api/xtream/media`**, not request count
— the leech was only 46 requests but 5.21GB. Cloudflare → your worker → Metrics,
or the GraphQL `httpRequestsAdaptiveGroups` query with
`clientRequestPath_like: "/api/xtream/media%"` grouped by `clientIP`. If a new IP
starts pulling gigabytes, the same-origin gate is being defeated (a scraper can
forge `Referer`) and the next step is binding the token to the client IP at mint
time.

## Known and accepted

- `max_connections: 1` on the line. Two honest viewers still drain each other.
  Nothing here changes that ceiling.
- IPTV Lab is pinned to a baseline predating the shared `mpegts-config`
  refactor, so `iptv-lab.html` and `assets/js/iptv-lab.js` still carry their own
  inline config. `tests/mpegts-config.test.js` documents that exemption rather
  than asserting against it — the locked, working bytes are authoritative. If
  the Lab is ever migrated, migrate and re-baseline it deliberately, and drop
  the exemption in the same change.
