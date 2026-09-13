# Handover — stream drain regression (Sep 9-12, 2026)

Read this, then `AGENTS.md` and `docs/STREAM-LOCK.md`. Work on a branch off `main`.

## START HERE — the drain was a leech, not the channel data

Everything below this section is still accurate about the beIN 5-9 / Thmanyah
channel bugs, and those are still worth fixing. **They were not what drained the
streams.** Cloudflare analytics settled it on Sep 13:

- In one 6-hour window, `/api/xtream/media` served **155 requests / 5.44GB**.
- **5.21GB of that (96%) came from a single client, `80.155.183.76`** (Windows/
  Firefox), running continuously through the night. The owner's own phone
  accounted for 0.23GB.
- The per-minute timeline shows both clients interleaved: a burst of 200s, then
  a `504` from the idle watchdog, then the other client gets a burst. That is
  two clients thrashing over a `max_connections: 1` line — the drain, captured
  live.

The line was effectively a public IPTV proxy: `/api/iptv-lab/live` minted a
signed, playable URL for anyone, with no Origin/Referer check (verified by
calling it from a bare container), and `TOKEN_TTL_SECONDS` was **6 hours**, so a
URL lifted from devtools played for the rest of the day.

This is why the drain hit IPTV Lab too, why reverting the channel data did not
help, and why redeploying did not help — none of those touched the leech.

**Done on Sep 13 (live, already in effect):**
- `80.155.183.76` blocked account-wide (Cloudflare IP Access Rule
  `aa3191d3ce104b98a586f6f73e32e994`).
- `XTREAM_TOKEN_SECRET` set to a fresh value on the `morshlive` worker,
  invalidating every outstanding media URL. It did not exist before, so it now
  takes precedence over `STREAM_SIGNING_SECRET` for media tokens only;
  `/wk/hls` signing is unchanged.

**Done in code (this branch, needs merge to reach production):**
- `TOKEN_TTL_SECONDS` 6h → 30min (`backend/adapters/xtream.js`).
- Same-origin gate on the playback-minting actions `live`, `channel`, `probe`
  (`backend/routes/iptv-lab.js`); metadata actions stay open.
- Edge cache on `catalog`/`categories` — `iptv-auto.js` was pulling the ~1.7MB
  catalogue every 45s per tab, 1,030 provider hits in 6 hours.
- Both locked files re-baselined in `scripts/verify-stream-lock.mjs` under
  `CLAUDE-STAMP … MEDIA-URL-LEECH-1`, same pattern as the watchdog change.

**Still open for whoever picks this up:**
- Watch the media bytes for a few days. If a *new* IP starts pulling GBs, the
  same-origin gate is being defeated (a scraper can forge `Referer`) and the
  next step is binding the token to the client IP at mint time.
- `npm test` is red on `main` — 2 pre-existing failures in
  `tests/mpegts-config.test.js`, fallout from the Sep-12 tree-wide rollback, not
  from this work.
- `max_connections: 1` is still the ceiling. Two honest viewers still drain each
  other. Nothing above changes that.

## What actually broke

Not the playback code. It was frozen the whole time and stayed frozen.

1. `2026-09-09 21:11` a scheduled goal.com harvest wrote `bein-sports-5` / `bein-sports-9`
   into `assets/data/today.json` for the first time.
2. `2026-09-10 12:06` #245 added beIN 5-9 to `CHANNEL_DEFS` in `assets/js/data.js`
   so the site would route them.
3. Those channels **resolve** in the catalogue but do not **play**.
   `getIptvLabChannel` (`backend/services/iptv-lab.js`) name-matches the catalogue and
   returns a `tsPlaybackUrl` without ever checking the feed delivers video.
4. Fixtures on 5 / 9 went live Sep 11-12 and drained.

Neither `assets/js/data.js` nor `assets/data/today.json` is in the Stream Lock table.
**The lock protects how we play, not what we are told to play.** That is the hole.

## Why six bad cards took down the Lab as well

The line is `max_connections: 1` (verified live: `/api/iptv-lab/status` →
`maxConnections: "1"`, `activeConnections: "1"`, valid to 2026-12-03).

- `mountLabChannel` (`assets/js/watch.js`) mounts `match.channelId` raw — not the channel
  the row resolved to. So a card can display beIN 1 and ask the lab for beIN 9.
- `assets/js/watch-lab-continuity-guard.js` reconnects on drain. Once `everPlayed` is true
  the 3-attempt cap no longer applies: it reconnects roughly every 6s forever.
- Pre-`ae812e3` the media proxy had no idle timeout and never aborted the upstream fetch.

So one viewer on a dead channel pins the single slot over and over, and every other
viewer — IPTV Lab included — drains. That is the amplifier. Fix the amplifier and a bad
channel id becomes a bad card instead of an outage.

`ae812e3` (XTREAM-IDLE-WATCHDOG-1, in `backend/adapters/xtream-media-safe.js`) is the
structural fix for step 3 of that chain. **Keep it.** It is already re-baselined in the lock.

## The invariant to enforce

> A channel id may reach the player only if `CHANNEL_DEFS` models it **and**
> `lib/xtream-channel-map.js` can resolve it. Anything else is stripped from the data
> before it ships.

Everything below is in service of that one sentence.

## Work items, in order

**1. Re-land the two guards that the Sep-12 rollbacks deleted.**
They were correct and they touch no locked file. Recover them from `ce2e8f6` (#247):
- `scripts/channel-overrides-lib.js` → `stripUnroutableChannels(matches, commentaryIndex)`,
  called **after** `mergeCommentaryIndex` in `scripts/refresh-broadcasts.js`. The ordering is
  the whole point: the merge carries a previously written row forward for as long as its
  fixture exists, so a stale channel outlives every source that named it. That is why
  #246's revert did not stop the drain.
- `scripts/goal-broadcasts-lib.js` → the `pickArabicBeinChannel` clamp, so the next harvest
  cannot write a channel above the modelled range.
- Derive the routable set from one place. Do not hand-maintain a second copy of the list.

**2. Fix the Saudi mismatch that the rollback created.** Live right now:
`today.json` has ~42 rows on `thmanyah` / `thmanyah-1..3`; restored `CHANNEL_DEFS` models
`ssc-1..3`; restored `lib/xtream-channel-map.js` parses only `bein-(sports|max|xtra)-[1-9]`.
Nothing resolves. It fails closed (404 → falls through, no drain) but Saudi cards have no
premium feed at all. Pick one and make the three agree — the Thmanyah mapping from
`d0f133d` is the one that was working before the rollback.

**3. Re-land the canary test** from #245 (`tests/channel-coverage.test.js`): every channel
named by `today.json`, `broadcast-overrides.json` or `manual-channel-overrides.json` must be
one the site can route. It fails CI instead of failing a viewer at kickoff. Without it,
item 1 rots.

**4. Cap the reconnect loop.** In `watch-lab-continuity-guard.js`, a post-`everPlayed`
reconnect should back off and give up after a bounded number of attempts, then surface the
failure to `watch.js` like the startup path does. A channel that never delivers video must
not be retried forever on a one-slot line. **This is a locked file — see baseline below.**

**5. Edge-cache the catalogue.** `backend/routes/iptv-lab.js` serves `/api/iptv-lab/catalog`
with `cacheSeconds: 0`, and `assets/js/iptv-auto.js` polls it every 45s from every page —
a full ~1.7MB provider pull per tab per tick. When a card is unresolvable the same tick also
fires `/api/iptv-lab/epg` (another catalogue pull + up to 64 `get_short_epg` calls). That load
lands exactly at kickoff. 60-120s of edge cache on catalogue, longer on EPG, costs nothing.

**6. Optional, only if asked:** #248 (`48bd991`) made `iptv-auto` fail closed off the watch
page. It was collateral in the tree-wide rollback, not a cause. Re-land it on its own commit
so it can be reverted independently.

## Stream Lock baseline

Leave it where it is: `8fe04a34` + `XTREAM-IDLE-WATCHDOG-1`. Do not re-baseline the whole
tree, and do not roll the watchdog back.

Items 1, 2, 3 and 5 touch no locked file — `data.js`, `today.json`, `scripts/`, `tests/` and
the route's cache header are all outside the table. Item 4 touches a locked file: use the
documented `config/stream-change-plan.json` + `KZ_STREAM_CHANGE_APPROVED` path in
`docs/STREAM-LOCK.md`, test it off the auto-deploy path, then re-baseline **only**
`assets/js/watch-lab-continuity-guard.js` in `scripts/verify-stream-lock.mjs` with a stamp
saying why — same shape as the watchdog entry. Nothing else moves.

If item 4 feels too risky to land alongside the rest, ship 1-3 and 5 first. They are
sufficient to stop the data from ever naming a channel that drains.

## Do not

- Do not run an automated probe or a CI live-media check. The line has one slot; a probe
  steals it from a real viewer and recreates this exact failure. The comment at the bottom of
  `.github/workflows/premium-iptv-smoke.yml` says so — keep that workflow as it is.
- Do not "fix" this by widening `CHANNEL_DEFS` to match whatever the harvest emits. That is
  #245, and it is what caused the outage. Widen only after the feed is confirmed to deliver
  video, and widen the map and the data in the same commit.
- Do not do another tree-wide rollback. Both of the Sep-12 ones deleted working guards and
  created the Saudi mismatch in item 2.

## Worth flagging to the owner once

`max_connections: 1` means any two simultaneous viewers drain each other regardless of code.
Everything above removes the self-inflicted multipliers; it does not raise the ceiling.
State it once, then build — it is the owner's subscription and the owner's call.
