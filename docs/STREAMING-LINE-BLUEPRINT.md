# The streaming line, end to end

A map of every component a video frame passes through on korazero.com, and a
catalogue of every mechanism known to drain it. Written to be the first thing an
agent reads before touching playback.

Verified against the tree at `92dd275` on **2026-09-16**. Every line reference
below was opened and read at that commit. If a line number does not match what
you see, re-verify before trusting the surrounding claim.

---

## 0. How to read this document

Claims are tagged. **Do not promote a tag without doing the work.**

| Tag | Means |
|---|---|
| **[VERIFIED]** | The code was read at the cited line. It says what is claimed. |
| **[MEASURED]** | Observed at runtime. The observation and its date are named. |
| **[THEORY]** | A mechanism proposed from code reading. Consistent, not demonstrated. |
| **[FALSIFIED]** | Was suspected, then ruled out. Recorded so it is not re-litigated. |

Two independent investigations feed this document: a primary trace, and a
second agent given only the symptom and no access to the first agent's
reasoning. Where they disagreed, that is stated rather than smoothed over.

---

## 0.5 The symptom, in the owner's own terms

**[REPORTED — the owner, over months of watching it]** This is the observation
every hypothesis has to satisfy, and it is not one pattern but three:

| Pattern | Frequency | What it rules out |
|---|---|---|
| **Lab and site drain together** | most common | Anything site-only. M1–M7 are all site-only. |
| **Only the Lab drains; the site is fine** | rarer | Anything *shared*, and anything site-only. See below. |
| **Only beIN drains; other channels play** | rarer | Anything channel-agnostic. |

Treat these as the primary evidence. They are cheap to collect, they come from
months of observation rather than a 60-second probe, and they discriminate
between mechanisms more sharply than anything in Appendix A.

**The second pattern is the strange one, and nothing in this document explains
it.** The Lab is the *simpler* page: no remount `setInterval`, no continuity
guard, no premium path, no match routing, no toolbar. A fault that takes down the
simple page while sparing the complex one cannot be any of M1–M7, and cannot be
anything shared either — a shared cause would take both. That leaves something
the Lab does *differently*.

**[FALSIFIED 2026-09-17] It is not a config divergence.** The obvious candidate
was that `assets/js/iptv-lab.js:589-594` duplicates the mpegts config inline
rather than importing `window.KZ_LIVE_TS_CONFIG`, and two copies of a config is
where drift hides. `tests/mpegts-config.test.js:57` explicitly exempts the Lab
from the shared-config assertion, so nothing would have caught a drift. The two
were compared by hand:

| Setting | Site (`lib/mpegts-config.js`) | Lab (inline) | mpegts.js 1.8.1 default |
|---|---|---|---|
| `enableWorker` | `false` | `false` | `false` |
| `enableStashBuffer` | `false` | `false` | `true` |
| `stashInitialSize` | `128` | `128` | `65536` |
| `enableWorkerForMSE` | `false` | *omitted* | **`false`** |
| `liveSync` | `false` | *omitted* | **`false`** |
| `liveBufferLatencyChasing` | `false` | *omitted* | **`false`** |

The Lab omits three keys the site sets explicitly, **and all three default to
exactly the value the site sets**. The two configs are functionally identical;
the duplication is a maintenance hazard, not a behavioural difference. Do not
spend time here.

So the second pattern remains **unexplained**, and the difference is somewhere
other than the player config.

**Beware of reasoning from a single session.** The same drain reported on two
different evenings may have two different causes; these three patterns are strong
evidence that more than one mechanism is in play. A fix that resolves one pattern
will look like it failed when the next pattern appears, and a fix that coincides
with a quiet evening will look like it worked (§1, Sep 13). Always ask **which
pattern** before reasoning about a report.

---

## 1. The constraint that explains most failures

**The provider line permits ONE concurrent stream.**

```
GET /api/iptv-lab/status  →  account.maxConnections: "1"
```

**[MEASURED 2026-09-16]** Live response: `maxConnections: "1"`,
`activeConnections: "1"`, `status: "Active"`, `expDate: 1796322120`
(2026-12-03), `allowedOutputFormats: ["m3u8","ts"]`.

Consequences that are not bugs and cannot be coded around:

- Two honest viewers at once degrade each other.
- **Any second connection opened by our own code — a remount, a reconnect, a
  probe, a second tab — competes with the viewer we already have.**
- A drain is therefore usually not "the stream is broken". It is "something
  asked for a second connection".

**Never open a live stream to test.** A probe takes the only slot from a real
viewer and reproduces the exact failure being investigated.
`.github/workflows/premium-iptv-smoke.yml` carries this warning too; that
workflow must stay as it is.

**[MEASURED 2026-09-15, Cloudflare analytics]** In the 16:00–22:00 UTC block,
78% of active streaming minutes had more than one viewer on the one-slot line.
Peak concurrency was 5. Of 810 stream drops in that window, 751 (93%) landed in
a contended minute — 6.4 drops/min contended vs 1.8 solo. Over 24 h, 6,976 of
18,742 API calls returned 504.

**[MEASURED] The audience, 19:00–22:00 UTC.** Needed for any sizing decision:

| Evening | Viewers | Peak concurrent | Minutes with >1 |
|---|---|---|---|
| Sep 9 | 14 | 7 | 90% |
| Sep 10 | 5 | 3 | 65% |
| Sep 11 | 5 | 3 | 43% |
| Sep 12 | 18 | 5 | 82% |
| Sep 13 — *reported working* | 14 | **2** | **19%** |
| Sep 14 | 3 | 2 | 60% |
| Sep 15 | 16 | 5 | 91% |
| Sep 16 | 15 | 6 | 83% |

Sep 13 was the quietest evening of the week by a wide margin, with a comparable
audience arriving *spread out* rather than together. A fix shipped that evening
was credited with the improvement; the quiet line is the better explanation.
**Do not treat one good evening as verification** — check concurrency first.

### One viewer already needs more than one connection

**[MEASURED]** Failure rate by how many people were on the line:

| On the line | Requests | Failure rate |
|---|---|---|
| **1 — alone** | 3,137 | **77%** |
| 2 | 3,565 | 52% |
| 3 | 2,645 | 52% |
| 4 | 1,760 | 51% |
| 5 | 973 | 54% |
| 6+ | 790 | 53% |

A viewer alone, with `max_connections: 1` satisfied and nobody to contend with,
failed **77%** of media requests — worse than when six people were watching, and
the curve from 2 to 6+ is flat. Contention would climb with load. It does not.

The reading that fits: **a single viewer generates more than one upstream
connection.** The player remounts, abandons an in-flight `/api/xtream/media`
request, the proxy has no idle watchdog (§2 Stage 6) so the abandoned fetch
lingers, and the viewer's next request collides with their own ghost. A long solo
session accumulates the most ghosts, which is why being alone is worst.

**Consequence for buying capacity:** the second connection is not for a second
viewer — it is what lets one viewer's reconnect coexist with their own dying
connection. It is the highest-value unit of slack available. Covering the peaks
in the table above, ghosts included, needs roughly 6–8.

**[CAVEAT]** The failure rate is Cloudflare-log-derived, and a 504 there cannot
be distinguished between a real upstream refusal and an abandoned client request
being recorded. The exact figure may overstate it; the direction holds, since
either reading requires more than one connection per viewer.

---

## 2. The path a frame takes

### Stage 1 — the card decides the URL

**[VERIFIED]** `assets/js/app.js:57-58`

```js
? `watch.html?ch=${m.channelId}&match=${m.id}`
: `watch.html?ch=live&match=${m.id}`;
```

Every non-ended card is a plain `<a class="watch-link">` (`app.js:84`). **No
club branch, no `source` parameter.** A normal card click can never enter the
premium path — that requires `?source=iptv-premium` in the URL.

### Stage 2 — the watch page picks channel and match

**[VERIFIED]** `assets/js/watch.js:2083-2093` `resolveSelection()` delegates to
`window.resolveWatchSelection`, defined at `assets/js/data.js:224-252`.

Precedence (`data.js:231-240`):

1. `explicitMatch.channelId` — the `match=` row's own channel **wins**
2. else the live match's channel when `ch` is absent or `live`
3. else the `ch` parameter
4. else `channels[0]`, falling back to `bein-sports-1`

Then `data.js:245` swaps the channel if it does not fit the fixture (the
Saudi/Thmanyah guard).

**Consequence [VERIFIED]:** two different cards that both carry
`channelId: "bein-sports-1"` resolve to the *same* channel. That is why "two
different matches, same channel" is normal and not itself a bug.

### Stage 3 — which player gets mounted

**[VERIFIED]** `assets/js/watch.js:1074-1090`, in order:

1. `xtreamMode` (`?source=xtream`) → `mountXtreamPlayer`
2. `premiumMode()` (`?source=iptv-premium` **and** a premium club) → premium path
3. **`mountLabChannel()` — our own IPTV. This is the normal path.**
4. only if that returns false: bridge / stream-plan / third-party embeds

### Stage 4 — resolving the channel (Worker)

**[VERIFIED]** `mountLabChannel` (`watch.js:1038-1045`) calls:

```
GET /api/iptv-lab/channel?id=<channelId>
```

Routed at `backend/routes/iptv-lab.js:12,32-50` → `getIptvLabChannel`
(`backend/services/iptv-lab.js:318`).

- `:328` load the catalogue
- `:329` `resolveXtreamChannel(channelId, streams)`
- `:330-343` **not found → 404 with an explicit error.** It deliberately does
  not fall back to an adjacent channel: a wrong channel plays a different match,
  which is worse than no picture.
- `:345-346` ask `getXtreamLive` for that stream id
- `:355-376` return `{ streamId, name, playbackUrl, tsPlaybackUrl, alternates }`

**[VERIFIED]** Resolution is *describe-and-search*, not a lookup table —
`lib/xtream-channel-map.js:1-23` explains why, and
`rankXtreamCandidates` (`:155-170`) filters on network + tier + number +
`language === "ar"`, then sorts by score. It is deterministic: **the same
channel id always yields the same stream row.**

`lib/xtream-channel-map.js:5-10` records that the old pinned ids **991 and 992
are not in the current catalogue at all.** This matters in Stage 3 case 2.

### Stage 5 — the signed media token

**[VERIFIED]** `backend/services/xtream.js:76-92` mints two tokens and returns
paths, never the provider URL:

```js
playbackUrl:   `/api/xtream/media/${hlsToken}`,
tsPlaybackUrl: `/api/xtream/media/${tsToken}`,
```

`createMediaToken` (`backend/adapters/xtream.js:406`) is AES-GCM over the
upstream URL plus an expiry. Key = `env.XTREAM_TOKEN_SECRET ||
env.STREAM_SIGNING_SECRET` (`:33-34`).

**[VERIFIED]** `TOKEN_TTL_SECONDS = 6 * 60 * 60` (`backend/adapters/xtream.js:8`).
`decodeMediaToken` (`:424-442`) throws `Expired media token` once past `exp`,
which the route turns into **403** (`backend/routes/xtream.js:48-52`).

#### The expired-token drain — found and fixed 2026-09-17 (`LAB-TOKEN-TTL-1`)

**[MEASURED]** `fetchLabChannel` in `watch.js` cached the
`/api/iptv-lab/channel` answer — and the signed media token inside it — for the
**life of the page**, with no expiry, against a token that dies after 6 hours.
A tab left open past that point reconnected forever against a dead token and got
403 every time. **50 of the 69 403s across all viewers over three days came from
one such session**: a phone that suspends a background tab and resumes it hours
later.

**Fixed.** The cache entry now expires after an hour (`LAB_CHANNEL_TTL_MS`),
comfortably inside the token's life. Lock re-baselined; only that cache changed,
no source, config, fallback or recovery logic.

`tests/lab-channel-cache.test.js` pins the *invariant* rather than the constant:
it parses both values out of the source and asserts the cache TTL stays at or
below half the token life, so changing `TOKEN_TTL_SECONDS` cannot silently
re-open this. It also asserts the age check itself survives — `has()` alone,
where present-but-stale counts as a hit, is the bug it replaced.

**This is a 403 mechanism, not a slot mechanism.** It made a long-lived tab fail
permanently; it does not explain a drain on a fresh session.

### Stage 6 — the media proxy

**[VERIFIED]** `backend/routes/xtream.js:44-53` → `proxyXtreamMediaSafe`
(`backend/adapters/xtream-media-safe.js:177-212`).

- decode token → fetch upstream (`:178-179`)
- sniff the first 64 bytes (`MANIFEST_SNIFF_BYTES = 64`, `:8`)
- `#EXTM3U` → rewrite the manifest so nested URLs are re-signed
- otherwise → stream the body through a `ReadableStream` (`:124-150`)

**[VERIFIED] There is no idle watchdog and no abort timer.** The only release
path is the consumer cancelling, which reaches upstream via
`cancel(reason) { return reader.cancel(reason); }` (`:147-149`). There is no
`AbortController`, no timeout, no idle detection anywhere in the file.
`XTREAM-IDLE-WATCHDOG-1` (`ae812e3`) added one and was later reverted.

### Stage 7 — playback and recovery

**[VERIFIED]** `watch.js:1052-1069` creates the mpegts player with
`window.KZ_LIVE_TS_CONFIG`.

**[VERIFIED]** `lib/mpegts-config.js` — every value is load-bearing and
documented in that file:

| Setting | Value | Why |
|---|---|---|
| `enableWorker` | `false` | worker transmuxing is unstable upstream |
| `enableWorkerForMSE` | `false` | needs MSE-in-Workers; turning it on blacked out iOS |
| `enableStashBuffer` | `false` | keeps live latency down; dispatches every chunk on arrival — **not a drain cause, see M9** |
| `stashInitialSize` | `128` | **bytes**, not KB (default is `65536`), and inert while the stash is off — **see M9** |
| `liveSync` | `false` | upstream #276 — live streams freeze within minutes |

**Consequence [VERIFIED]:** all MPEG-TS demuxing and MSE appends happen on the
main thread. Any other main-thread work competes directly with playback.

**[VERIFIED]** `assets/js/watch-lab-continuity-guard.js` wraps
`mpegts.createPlayer` for Lab-backed live TS sources only (`:36-43`). Constants
at `:29-34`: `WATCHDOG_MS = 1000`, `DRAIN_GRACE_MS = 5500`,
`RECONNECT_MS = 700`, `MAX_START_ATTEMPTS = 3`.

`runWatchdog` (`:183-200`) reconnects when `bufferedAhead() < 0.35 ||
readyState < 3` and `currentTime` has not advanced for 5.5 s.

**[VERIFIED]** The 3-attempt cap applies **only before first play** (`:153`).
After `everPlayed` is true (`:172`), `scheduleReconnect` re-fires at a flat
700 ms forever (`:168`):

```js
}, everPlayed ? RECONNECT_MS : RECONNECT_MS * Math.max(1, startAttempts));
```

---

## 3. The timers

Every periodic job on the watch page. **When diagnosing a drain, the period of
the symptom is the strongest single clue you have.**

| Period | Where | What it does |
|---|---|---|
| **20 s** | `watch.js:2174-2178` | `fetchAndApplyPlan()` → **`loadPlayer()`** — can remount the player |
| **45 s** | `iptv-auto.js:24, 509` | `refreshAndRewrite()` → whole-catalogue scan, document rewrite |
| **60 s** | `watch.js:2179` | `refreshMatchDetail()` — ESPN summary, lineups, stats, sidebar |
| **90 s** | `watch.js:2173` | `refreshMatches({force:true})` → includes `renderPremiumSourceTabs()` |
| **120 s** | `watch.js:2180-2186` | `StreamCheck.autoHighlight` — **gated off outside xtream mode**, so it never runs on a match page (see §5) |

**[VERIFIED]** `stream-plan-api.js:7` caches for 15 s while the tick is 20 s, so
the 20 s tick always misses the cache and always makes a real
`/api/stream-plan` request.

---

## 4. Known drain mechanisms

Ordered by current suspicion, not by discovery order.

**Read M9 first** — for what it rules out and for the mistake it records. It is
the only entry carrying runtime measurement, and it eliminates the transport, the
feeds and the player's buffer config.

**No mechanism in this section is confirmed, and none of M1-M7 can explain a
drain that reaches the Lab as well as the site** — the Lab has none of them. Every
one of M1-M7 is inferred from reading code and not one has been instrumented. If
the symptom includes the Lab, the shared constraint in §1 and the fix in §7b are
the honest place to look, not this list.

### M1 — The 20-second remount loop

**[VERIFIED]** `watch.js:2174-2178`

```js
setInterval(() => {
  fetchAndApplyPlan().then(() => loadPlayer())
}, 20 * 1000);
```

`loadPlayer()` → `mountLabChannel()` (`:1090` → `:1038`). The only thing that
stops a remount is the guard at `:1043`:

```js
if (labChannelAlreadyHealthy(channelId)) return true;
```

**[VERIFIED]** `labChannelAlreadyHealthy` (`:1016-1020`):

```js
return !!(video && video.readyState >= 2 && !video.error && !video.ended);
```

When the guard returns false, `:1047-1064` runs:

- `destroyInlineHls()` — tears the live player down (`:329-347`, correctly:
  pause, unload, detachMediaElement, destroy)
- `shell.innerHTML = '<video …>'` — **replaces the video element**
- creates a new mpegts player and calls `.load()` → **a new
  `/api/xtream/media/<token>` request**

**[VERIFIED]** The intent was already known. The comment at `:1041-1042` reads:
*"the 20s/90s metadata ticks must not become playback ticks. Same channel +
healthy media = leave it alone."* The guard exists for exactly this. The
predicate is the problem, not the idea.

**[MEASURED 2026-09-16]** The owner reports the drain recurring "exactly every
approximately 20 seconds", **with no gold button present on the page**. 20 s
matches this timer and no other.

**[THEORY]** The loop is self-sustaining: a dip deep enough to cost the player
its current frame drops `readyState` to 1 → the next 20 s tick fails the guard →
remount opens a second session on a one-slot line while the first unwinds →
the dip deepens → `readyState` stays low → the next tick remounts again.

**[THEORY]** Because `max_connections: 1` and there is no idle watchdog (§2
Stage 6), the abandoned upstream may still hold the slot when the replacement
asks for it.

**Not yet instrumented.** Confirm before fixing — see §6.

**Candidate fix (not applied).** Relax the predicate so a rebuffering player is
left alone; only a player with *nothing* is remounted. Genuine stalls are
already owned by the continuity guard (§2 Stage 7), which acts after 5.5 s of no
progress. `watch.js` is **stream-locked** — see §7.

### M2 — The premium ("gold") toggle churn

**[VERIFIED]** `watch.js:2053-2080`. Line `:2058` is the entire divergence
between a premium-club card and any other:

```js
if (!premiumChannelFor(match)) return;   // non-premium exits here
…
host.prepend(tabs);                      // premium adds nodes
```

`premiumChannelFor` (`:106-117`) matches Barcelona, Liverpool, Tottenham,
Atlético Madrid → stream 991; Manchester City → 992 (`:45-48`). Called from
`refreshMatches` at `:2110` and `:2163`, so it re-runs **every 90 s**.

**[VERIFIED]** `#player-toolbar` is one of four roots `iptv-auto` observes
(`iptv-auto.js:485-489`), and its observer fires only when
`mutation.addedNodes.length` (`:496`). A non-premium card's early return removes
nodes but adds none, so the observer never fires there. A premium card's
`prepend` fires it every tick → `rewriteAll(document)` → a document-wide
`a[href*="match="]` scan (`originalWatchAnchors`, `:243-255`).

**[VERIFIED]** A third script joins: `iptv-legacy-toggle-normalizer.js:80-98`
matches the toggle and does `toggle.replaceWith(link)` (`:97`).

**[VERIFIED]** `iptv-mutation-guard.js:1-8` exists *because* this loop
"can continuously rewrite the same toggle and **starve the browser main
thread**". Its filter suppresses mutations *inside* a toggle — **not** mutations
on `#player-toolbar` itself, which is what `prepend` and `replaceWith` produce.

**[MEASURED 2026-09-16]** On a live Barcelona fixture, in a local harness with
the media endpoint blocked: the toggle **is** created, then the normalizer
replaces it. `.watch-source-toggle` count settles at **0**. What remains is:

```html
<a class="watch-link" role="tab" aria-selected="true" href="/watch.html?ch=bein-sports-1&match=…">شاهد الآن</a>
```

**So the gold styling is not visible today even on a premium club.** "No gold
button" does not mean the premium code path did not run.

**Status: real mechanism, NOT the current drain.** Its period is 90 s; the owner
measured 20 s. Both investigations independently judged its cost too small —
single-digit milliseconds per 90 s — to move a video buffer.

### M3 — Toolbar anchor accumulation

**[VERIFIED]** `watch.js:2056-2057` removes only `.watch-source-toggle` and
`.premium-source-tabs`, and uses `querySelector` (the **first** match only), not
`querySelectorAll`. The normalizer's replacement `<a class="watch-link">` is
neither class, so nothing ever removes it.

**[THEORY]** On a premium-club card the toolbar gains one orphaned anchor every
90 s, unbounded, for the life of the page. Each carries `match=`, so every
subsequent document-wide scan has more nodes to walk — the periodic work grows
with session age.

**Not measured.** The runtime test was started on 2026-09-16 and interrupted
before producing data. This is the only known mechanism that gets *worse the
longer a tab stays open*, which makes it worth measuring if a drain correlates
with session length.

### M4 — The live-match detail machinery

**[VERIFIED]** 60 s tick at `watch.js:2179` → `refreshMatchDetail`
(`:1688-1704`). Gated twice:

- `:1690` — returns unless `match.status` is `live` or `upcoming`
- `match-detail-api.js:40-51` `shouldFetchDetail` — true for `live`, or
  `upcoming` within **[-3 h, +6 h]** of kickoff, or `ended` missing lineups/stats

Out of window, `fetchDetail` returns null and nothing happens at all. In window,
per tick:

- a full ESPN summary fetch
- **`renderMatchDetail()` runs twice** — once inside `fillInfo()` (`:1765`; note
  `fillInfo` begins at `:1712`), then again directly at `:1700`
- `renderSidebar()` rewrites `#side-channels` — another `iptv-auto` observed root

**Status: real and magnitude-appropriate, but its period is 60 s.** It is
*not* the cause of the 20 s symptom. It is **not eliminated** as a contributor
to drains on genuinely live fixtures.

The independent evaluator ranked this its leading cause at ~60% confidence,
explicitly conditional on the premium card being in its TV window and the
comparison card not being. That condition was never established.

> **Correction — do not repeat this mistake.** During this investigation it was
> claimed that `assets/data/today.json` being frozen at 2026-08-22 falsified M4,
> because every fixture in it is far outside the window. **That was wrong.**
> `today.json` is not the runtime match source: the client merges it with a live
> `/api/football/scoreboard?dates=…` call (`matches-api.js:278`), and team names
> come from ESPN `displayName` (`:236-237`). The card list is current. M4 stands.

### M5 — The premium path as a second playback route

**[VERIFIED]** `watch.js:43` reads `premiumRequested` from the URL; `:119-121`
`premiumMode()` = `premiumRequested && premiumChannelFor(match)`; `:1080-1087`
branches `loadPlayer` into the premium mount.

**[VERIFIED]** The pinned ids 991/992 are not in the catalogue
(`lib/xtream-channel-map.js:5-10`), so this path errors, shows an error box, and
bounces back — and each navigation opens another session.

**Requires a click or a crafted URL.** A normal card click cannot reach it
(§2 Stage 1). When investigating a reported drain, **ask whether the gold
button was clicked** — it changes the answer completely.

### M6 — Uncapped reconnect after first play

**[VERIFIED]** `watch-lab-continuity-guard.js:153` applies the 3-attempt cap
only when `!everPlayed`. After first play, `:168` reconnects at a flat 700 ms
indefinitely. Each reconnect is a teardown plus a **new** media request.

**Symmetric across all cards.** It does not differ between fixtures, so it never
explains why one card drains and another does not — but it shapes what a drain
*looks like* once started.

### M7 — No idle watchdog on the proxy

**[VERIFIED]** §2 Stage 6. Plus `TOKEN_TTL_SECONDS = 6 h`
(`backend/adapters/xtream.js:8`).

**[THEORY]** An abandoned upstream can hold the single slot until the runtime
propagates a cancel, so every duplicated or abandoned mount costs more than it
did while `XTREAM-IDLE-WATCHDOG-1` was in place.

### M9 — Bursty delivery is normal, and nothing here is the drain  ← read first

**[RETRACTED 2026-09-17]** An earlier version of this entry claimed, as
**[MEASURED]**, that the provider drops two-second segments and that beIN Sports
1 was pinned to a broken feed. **That was wrong**, the resolver change it
justified has been reverted, and the reasoning is kept here because the mistake
is instructive and cheap to repeat.

What was seen: total delivery gaps of 1985-2042 ms, twenty-one of them across
feeds from two unrelated broadcasters. Uniform length looked like a dropped
segment. What was actually happening: **this transport does not trickle bytes at
the playback rate — it flushes roughly 256 KiB at a time** (in ~16 KiB network
chunks), so a perfectly healthy feed spends whole seconds delivering nothing and
then catches up. The gaps were the flush interval, which is why they were
identical across unrelated broadcasters — that should have been the clue, and it
was read as corroboration instead.

The tell that settled it: the seconds after each quiet window carry a **2.75x
catch-up burst**. The bytes were late, never missing.

**[MEASURED 2026-09-17]** Modelled as a leaky bucket over real arrival times —
draining at the feed's own bitrate, how far behind did the player ever fall?

| feed | mean | quiet windows >1.5s | prebuffer needed |
|---|---|---|---|
| `2449` beIN_1HD_1080p | 2.85 Mbps | 4 | **0.08 s** |
| `46028` beIN_SPORTS_1_1080FHD | 5.47 Mbps | 0 | 0.16 s |
| `241362` Thmanayah 1 | 5.00 Mbps | 0 | 0.15 s |
| `241363` Thmanayah 2 | 3.29 Mbps | 10 | 0.12 s |

`241363` had ten quiet windows and still never put a player more than 0.12 s
behind. **No feed measured is starving the player**, and the feed with the most
quiet windows needs the least buffer of the four.

**So the transport is not the drain.** Feed choice, resolution and provider
health are all ruled out as causes — the earlier ladder test had already
falsified resolution (§5), and this rules out the rest.

**[LIMIT — read before trusting the table]** Measured from a datacentre with
excellent connectivity. It establishes that the *origin and the Worker* deliver
fine; it says nothing about a phone on a congested mobile network, which is what
most viewers are on. Last-mile delivery remains unmeasured.

**[FALSIFIED 2026-09-17] The stash buffer is not the cause either.** Both
players disable it (`assets/js/mpegts-config.js:11` for the site via
`window.KZ_LIVE_TS_CONFIG`; `assets/js/iptv-lab.js:593` for the Lab, duplicated
inline), and since that is the one thing the Lab and the site share, it was the
only candidate that could explain a drain hitting both at once. It does not,
and this was settled by reading mpegts.js 1.8.1 rather than by measuring.

`IOController._onLoaderChunkArrival` branches on `_enableStash`. With the stash
disabled it takes the `_stashUsed === 0` path:

```js
} else if (this._stashUsed === 0) {
    consumed = this._dispatchChunks(chunk, byteStart);   // immediately, on arrival
```

Every chunk is handed to the demuxer the moment it lands. There is no
accumulation, no wait and no timer anywhere on that path; only bytes the demuxer
could not consume (a partial TS packet) are retained for the next call. So
disabling the stash is the **lowest-latency** path, and it puts data into the
playback buffer *sooner* than a stash would, because a stash holds bytes back.
It cannot produce a drain from bursty delivery — it is the configuration best
suited to it. The upstream warning it overrides ("may stall if there's network
jittering") is about trickling connections where dispatching tiny fragments is
wasteful, not about bursts that arrive in full.

Two corrections that came out of the same read, both of which this document
previously got wrong:

- **`stashInitialSize` is in bytes in this build**, not KB. The constructor sets
  `this._stashInitialSize = 65536` and a configured value replaces it directly,
  so `128` means 128 *bytes*. An earlier revision of this file called it "128 KB,
  half of one 256 KiB flush". That was wrong twice over.
- **It is inert while the stash is off.** It only sizes the leftover-remainder
  path, and the backing allocation is `Math.max(_stashSize, 3145728)` — 3 MB
  regardless.

**So nothing in §4 currently explains a drain that reaches the Lab as well as the
site.** M1-M7 are site-only. That is an open question, not a solved one, and the
honest place to look next is §1: the one-connection ceiling is shared by both,
and §7b is the structural answer to it.

**Method, for the next agent.** Counting quiet seconds is **not** a health metric
on this transport; it measures burstiness. Use `bufferFloorSeconds` (prebuffer
required), which is what `run.mjs transport` now reports. Two readings that agree
because they share a wrong assumption are not corroboration.


### M8 — External leech (historical, resolved)

**[MEASURED, Sept 2026]** A single client pulled 53.4 GB over four days —
roughly 49% of the week's media bytes — touching only `/api/xtream/media` and
never any page. Peak burst 3,907 MB in one minute. On 2026-09-11 real viewers
received 58 watch-minutes while 17.7 GB went to that address.

Blocked account-wide via Cloudflare IP Access Rule
`aa3191d3ce104b98a586f6f73e32e994`. **Removing that rule re-opens the drain.**

Watch **bytes** on `/api/xtream/media` grouped by `clientIP`, not request
counts — the leech was only 46 requests for 5.21 GB in one six-hour window.

---

## 5. Falsified — do not re-investigate without new evidence

| Suspicion | Why it is out |
|---|---|
| CSS animation on the gold toggle | **[VERIFIED]** No `@keyframes` and no `animation` property on `.watch-source-toggle*` (`styles.css:1035-1105`, `dark-refresh.css:304-313`). The only motion is a 150 ms hover `transition` at `styles.css:1075`, which costs nothing while idle. |
| `stream-plans.json` differing per card | **[VERIFIED]** `loadPlayer` returns at `:1090` before any plan code whenever the Lab mount succeeds; `allowAutoHeal` is false in both the catalog policy (`lib/stream-plan.js:250`) and the legacy policy (`:379-384`). |
| `stream-check.js` probing servers | **[VERIFIED]** Gated on `allowLegacySourceChrome()` (`watch.js:123-132`), which returns false as soon as a `match=` is present (`:125-126`) — and in fact returns false for **every** non-xtream case, since the function ends in a bare `return false` (`:131`). That gate guards `renderChannels` (`:1896`), `renderServers` (`:1943`) and the 120 s `StreamCheck` tick (`:2181`). No probe traffic on a match page. |
| `iptv-quality.js` | **[VERIFIED]** Loaded only by `iptv-lab.html:182`. Not on the watch page. |
| `iptv-premium-card-click.js`, `psg-live-hotfix.js`, `railway-freeze-diagnostics.js`, `iptv-epg-auto.js` | **[VERIFIED]** Not in any live bootstrap (`i18n.js:66-78`), asserted by `tests/iptv-rollout-contract.test.js:169`. Note the same bootstrap gates `iptv-auto.js` behind `if (isWatchPage)` (`i18n.js:73`). |
| A card resolving to a different channel than it displays | **[VERIFIED]** Resolution is deterministic (§2 Stage 4). Two cards with the same `channelId` get the same stream row. |
| "The gold button is gone, so the premium code did not run" | **[MEASURED]** False — see M2. The normalizer eats the styling; the code ran. |
| "The provider is under-delivering / dropping segments" | **[MEASURED 2026-09-17]** False for every feed measured. Modelled against real arrival times, no feed put a player more than **0.16 s** behind — see M9. Quiet windows are the upstream flush interval, followed by a 2.75x catch-up burst. Caveat: measured from a datacentre, so last-mile delivery to a phone is still unknown. |
| "beIN drains because it runs at 1080 while the rest of the Lab is 720" | **[MEASURED 2026-09-17]** False, twice over. A nine-rung ladder across every beIN Sports 1 feed found health does not track resolution at all: the **4K** rung was the healthiest measured (8.55 Mbps, 0 stalls) while the two *lowest* rungs (512K, SD) died inside 0.5 s and the Low rung stalled 9 times. Then `46028`, a **1080** feed, measured 0 gaps at 5.91 Mbps — nearly twice the throughput of the 1080 feed that was failing. The fault is per-feed (M9), not per-resolution. Falling *back* to a lower rung would have made it worse. |
| "The heavy feed collapses because many viewers hit one stream" | **[MEASURED]** False — the dose-response runs the wrong way: 1 viewer showed 77% failure, and 2–6+ viewers sat flat at ~52%. Contention would climb with load. See also the note on `max_connections: 1` in §1. |

---

## 6. Diagnosing a new drain

**Do not open a stream to test.** Work from a session that is already playing.

### Step 0 — is the feed delivering at all?

Cheapest decisive test, and the one that found M9. It needs the line's one slot,
so check `GET /api/iptv-lab/status` for `activeConnections: "0"` first and keep
the run short — you are borrowing the line from a real viewer.

```
node scripts/diagnostics/run.mjs transport --stream=<site pick> --stream=<a sibling> --live --seconds=75
```

Use **`transport`**, not `compare`. `page`, `channel`, `stream` and `compare`
all drive a real browser and need one that can decode H.264/AAC; the bundled
headless Chromium usually cannot, and when it cannot they report `NEVER STARTED`
with zero media requests, which reads as a dead feed and is not. Both scenarios
accept `--stream` twice, so the wrong one fails by returning empty results
rather than an error.

Read the **gap rhythm**, not just the stall count:

- gaps of scattered length → congestion or loss, look at the network
- gaps of **uniform length** → a clock: a dropped segment, a timeout, a retry
- a sibling feed pulled back-to-back that does *not* gap → the fault is that
  one feed, not the path, and the fix is the ranking (M9), not the player

Run the site's pick against its `alternates` from
`/api/iptv-lab/channel?id=<channel>`. One healthy sibling is what separates
"the stream is bad" from "this feed is bad".

### Step 1 — take the period

The period identifies the mechanism, and costs nothing. In devtools on the
watch page, while draining:

```js
let n=0,last=0;
new MutationObserver(r=>r.forEach(m=>m.addedNodes.forEach(x=>{
  if(x.tagName==='VIDEO'){const t=performance.now();
    console.log(`REMOUNT #${++n}  +${last?((t-last)/1000).toFixed(1):0}s`, new Date().toLocaleTimeString());
    last=t;}
}))).observe(document.getElementById('player-shell'),{childList:true,subtree:true});
```

A new `<video>` element every ~20 s is M1, proven.

| Interval between dips | Mechanism |
|---|---|
| ~20 s | **M1** — the remount loop |
| ~45 s | iptv-auto catalogue scan |
| ~60 s | **M4** — live-match detail refresh |
| ~90 s | **M2/M3** — premium toggle churn / accumulation |
| irregular | none of the above — look at connections, not the main thread |

### Step 2 — establish contention before blaming code

```bash
curl -s https://korazero.com/api/iptv-lab/status | grep -o '"activeConnections":"[0-9]*"'
```

If someone else is watching, that alone explains a drain (§1).

Then check bytes and status codes per IP over a one-day window (the plan's
maximum) via the Cloudflare GraphQL `httpRequestsAdaptiveGroups` API:
`clientRequestPath_like: "/api/xtream/media%"`, grouped by `clientIP`, summing
`edgeResponseBytes`. A new IP pulling gigabytes is a leech, not a bug.
`clientAsn` and `clientRefererHost` are **not available** on this plan.

### Step 3 — ask the owner two questions

1. Was the gold button clicked? (M5 changes everything.)
2. Was the fixture live at the time? (M4 only runs in window.)

### Step 4 — reproduce without touching the line

A local harness can serve the repo and proxy `/api/*` to production while hard-
blocking `/api/xtream/media`, `/api/iptv-lab/live` and `/api/iptv-lab/probe`, so
the provider is never reached. Caveats found on 2026-09-16:

- The sandbox proxy re-terminates TLS, so headless Chromium cannot load
  `korazero.com` directly (`ERR_CERT_AUTHORITY_INVALID`). Serve locally instead.
- `mpegts.js` and `hls.js` come from `cdn.jsdelivr.net` and must be routed
  through Node (which does trust the CA) or the player never exists.
- **Match ids expire.** A fixture more than a few days old is not in the merged
  list, `match` resolves to null, and premium code silently never runs. Always
  pick a *current* fixture.

---

## 7. Rules before changing anything

1. **Never probe or auto-test the live stream.** One slot. A probe is an outage.
2. **`assets/js/watch.js` is stream-locked**, along with 33 other playback files
   (`scripts/verify-stream-lock.mjs`, baseline `8fe04a34`). Run
   `node scripts/verify-stream-lock.mjs` before and after any work. Changing a
   locked file requires the documented `config/stream-change-plan.json` +
   `KZ_STREAM_CHANGE_APPROVED` path in `docs/STREAM-LOCK.md`, then re-baselining
   **only** the changed file with a stamp saying why.
3. **Do not widen `CHANNEL_DEFS` to match whatever the data emits.** That caused
   the Sep-09 outage. Confirm the feed delivers video first, and change the map
   and the data in one commit.
4. **Do not do tree-wide rollbacks.** Both Sep-12 rollbacks deleted working
   guards and created new mismatches.
5. **Measure bytes, not requests**, whenever the question is "who is using the
   line".
6. **Raising `max_connections` is the only change that lifts the ceiling.**
   Everything in this document removes self-inflicted multipliers. None of it
   makes the line serve two viewers.

---

## 7b. Fan-out — the structural fix, and what is known about it

The ceiling in §1 (`max_connections: 1`) is the one constraint no front-end change
can survive. Today the worker opens **one upstream connection per viewer**, so N
viewers need N connections against a limit of 1. Fan-out means **one upstream
connection per channel**, shared. The provider then sees exactly one client — us —
regardless of audience size.

Facts established 2026-09-17, so the next agent does not re-derive them:

**[MEASURED]** The provider's HLS is genuinely segmented, not a wrapper around a
continuous stream. `GET` the `playbackUrl` manifest:

```
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:1087
#EXT-X-ALLOW-CACHE:YES        ← the provider explicitly permits caching
#EXT-X-TARGETDURATION:10
#EXTINF:10.000000             ← six discrete 10 s segments, rolling
```

**[MEASURED]** Two viewers resolving the same channel receive **zero segment URLs
in common** — six unique signed tokens each, for the same six segments. So
`caches.default` cannot dedupe them as they stand; a cache must key on the
*decoded upstream URL*, not the token. Combined with `Cache-Control: no-store` on
every media response, nothing is cached today.

**[VERIFIED]** The site plays `tsPlaybackUrl` through mpegts.js
(`watch.js:1052-1069`), not the HLS path — `playbackUrl` and `rewriteManifest`
exist and hls.js is loaded, but TS is what mounts.

The consequence for choosing an approach:

| | Client change needed | Provider connections |
|---|---|---|
| **A** cache HLS segments at the edge | **Yes** — clients must move from TS to HLS, and both players are stream-locked | ~1 per segment, but N concurrent if viewers are out of sync, so it needs request coalescing |
| **B** Durable Object tees one upstream | **None** — clients keep requesting `/api/xtream/media/<token>` and the worker serves them from the shared stream | Exactly 1, permanently |
| **C** repackage to HLS in R2 | Yes | 1 — but this is building a CDN |

**A is the smaller diff but touches locked client files; B is more infrastructure
and is invisible to the client.** That reverses the naive reading of "cheapest".

**What fan-out fixes regardless of root cause:** viewer contention, ghost
connections from abandoned requests, the remount loop's amplification (a remount
re-attaches instead of opening a new upstream), and a leech pulling through our
own proxy. Every surviving suspect in §4 is in that family.

**What it does not fix:** another device using the same credentials off-platform,
a genuinely bad provider feed (M9: measured fine), and client-side rendering
faults. Nor does it help a lone viewer with no ghosts.

**Economics first.** Ask the provider what additional connections cost before
building any of this. More connections raise the ceiling; fan-out lowers the
demand. Fan-out is the better engineering, a subscription upgrade is usually the
better value, and they are not exclusive.

---

## 8. Open items

| Item | State |
|---|---|
| M1 confirmation (remount period) | Snippet in §6 Step 1. Not yet run. |
| M1 fix | Designed, **not applied** — `watch.js` is locked, needs approval. |
| M3 accumulation | Predicted from code, never measured. |
| Idle watchdog (M7) | Absent since `ae812e3` was reverted. Not scheduled. |
| Reconnect cap (M6) | Uncapped after first play. Not scheduled. |
| What explains a Lab + site drain | **Nothing in §4 does.** The stash-buffer theory was the only candidate and is falsified (M9). M1-M7 are site-only. Open. |
| Player-side behaviour under a real decoder | Every browser-driven scenario reports NEVER STARTED here — no H.264/AAC in the bundled Chromium. Nothing about what the *player* does with the bytes has been observed, only what arrives. |
| Last-mile delivery | Every transport measurement so far is from a datacentre. Nothing is known about delivery to a phone on a mobile network, which is what most viewers use. |
| A wrong `[MEASURED]` claim shipped | M9's first version asserted dropped segments and drove a change to a stream-locked file. Reverted. The metric that caused it (counting quiet seconds) is replaced by `bufferFloorSeconds`. |
| `alternates` is read by nobody | `resolveXtreamChannel` computes and returns it, and **zero** client code consumes it. There is no failover today — a bad feed is simply played. |
| `alternates` contains wrong channels | **[VERIFIED]** For `bein-sports-1` the list carries `669 [FR]_BeIN_SPORTS_1_HD` and `89778 BeIN Alkass 1 HD`. The language filter sets `fr` only on `/\bfrench\b\|\bfra\b/`, neither of which matches the token `fr`, so `[FR]` reads as Arabic — Turkish gets a `tokens.includes("tr")` check that French and English never got. Alkass is a different Qatari broadcaster that passes because its name contains "bein" and a `1`. Harmless only while nothing reads the list; **fix both before building any failover on it.** |
| Other channels never health-checked | M9 was found on beIN because that is where the complaint was. No other channel's pick has been measured, and any of them could be sorted onto a bad feed the same way. |

---

## Appendix A — every measurement, 2026-09-17

The complete record, including the runs that produced wrong conclusions. Kept in
full because the conclusions changed three times and a future reader needs the
raw numbers to check the reasoning rather than inherit it.

All transport runs used `scripts/diagnostics/run.mjs transport --live`, which
pulls bytes from production with **no browser and no decoder**, via Node.
Measured from this agent environment (datacentre connectivity), **not** from a
phone on a mobile network. The line was confirmed `activeConnections: 0/1` before
each run.

### A.1 Channel resolution, as the site does it

`GET /api/iptv-lab/channel?id=…`, live:

```
bein-sports-1  PICKED 2449   beIN_1HD_1080p          1080 h264
        alt          46028   beIN_SPORTS_1_1080FHD   1080 h264   ← ties with the pick
        alt          3177    beIN_1_HD720            hd   h264
        alt          89778   BeIN Alkass 1 HD        hd   h264   ← different broadcaster
        alt          669     [FR]_BeIN_SPORTS_1_HD   hd   h264   ← French feed

thmanyah-1     PICKED 241362 Thmanayah 1 1080        1080 h264   ← sole 1080, no tie
        alt          241359 / 243323 / 241356 / 243326
thmanyah-2     PICKED 241363 Thmanayah 2 1080        1080 h264   ← sole 1080, no tie
thmanyah-3     PICKED 241364 Thmanayah 3 1080        1080 h264   ← sole 1080, no tie
```

`2449` and `46028` score identically (both 1080 h264) and `Array.sort` is stable,
so catalogue order decided which one every viewer got.

### A.2 The quality ladder — 7 rungs × 35 s, all beIN Sports 1

Run to test "beIN drains because it is 1080". It falsified it.

| Stream | Name / quality | Mean Mbps | Quiet windows |
|---|---|---|---|
| `4905` | 512K, lowest | 0.02 | **died at 0.5 s** |
| `22` | Low | 0.68 | 9 |
| `2463` | SD | 0.02 | **died at 0.5 s** |
| `3177` | HD720 | 5.03 | **0** |
| `2449` | 1080p ← *the site's pick* | 3.28 | 2 |
| `46028` | 1080FHD | 4.97 | 1 |
| `59331` | 4K | **8.55** | **0** |

Health does not track resolution. The 4K rung was the healthiest of the nine and
the two lowest rungs died inside half a second. **Falling back to a lower rung
would have made things worse**, which is the opposite of the intuition.

### A.3 Run A — `2449` vs `3177`, 75 s each, back to back

| | `2449` beIN_1HD_1080p | `3177` beIN_1_HD720 |
|---|---|---|
| time to first byte | 891 ms | 920 ms |
| delivered | 24.4 MB | 34 MB |
| mean / median / min | 2.6 / 2.1 / 0.07 Mbps | 3.63 / 2.1 / 0.11 Mbps |
| quiet windows >1.5 s | **5** | **0** |

`2449` gaps: at 1.9 s (1999 ms), 7.9 s (1985), 24.9 s (2001), 40.9 s (2013),
58.0 s (2027).

**This is the run that produced the wrong conclusion.** Five gaps within 42 ms of
2000 ms, against a sibling feed with none, read as "this feed drops segments".

### A.4 Run B — `2449`, 150 s, separate connection ~15 min later

```
ttfb 636 ms   delivered 47.5 MB   mean 2.53 / median 2.1 / min 0.46 Mbps
quiet windows: 5
gaps: 27.7 s (1985 ms), 38.7 s (1987), 48.7 s (1993), 130.8 s (2010), 145.8 s (1989)
```

Confirmed the uniform ~2000 ms length across a second connection — and **refuted
the periodicity**: spacing here is 11.0 / 10.0 / 82.1 / 15.0 s, against 6.0 /
17.0 / 16.0 / 17.1 s in Run A. Only the *duration* is fixed, never the cadence.
An earlier claim of a "~16-17 s period" was wrong and is withdrawn.

### A.5 Run C — `46028` vs `3177`, 75 s each

| | `46028` beIN_SPORTS_1_1080FHD | `3177` beIN_1_HD720 (control) |
|---|---|---|
| time to first byte | 827 ms | 828 ms |
| delivered | 55.4 MB | 38.2 MB |
| mean / median / min | 5.91 / 4.19 / 0.79 Mbps | 4.08 / 4.19 / 2.1 Mbps |
| quiet windows | **0** | **0** |

The control matched its three earlier runs, so conditions were normal.

### A.6 Run D — all three Thmanyah picks, 60 s each

| | `241362` Thm 1 | `241363` Thm 2 | `241364` Thm 3 |
|---|---|---|---|
| time to first byte | 829 ms | 675 ms | 1146 ms |
| delivered | 36.4 MB | 24.4 MB | 20.3 MB |
| mean Mbps | 4.86 | 3.25 | 2.71 |
| quiet windows | 1 | **8** | 2 |

Gap lengths — `241362`: 2001 ms. `241363`: 1997, 2001, 2011, 1982, 2013, 2042,
1950, 2004. `241364`: 2019, 1954.

**This is the run that broke the theory.** Thmanyah is a different broadcaster
from beIN, its picks have no scoring tie, and it showed the same ~2000 ms figure.
Twenty-one gaps across four feeds and two broadcasters, every one between 1950
and 2042 ms. Identical across unrelated sources means shared path, not shared
damage.

### A.7 Run E — `241363`, 90 s, delayed-or-dropped test

The decisive run. Per-second delivery, Mbps:

```
 0.81 55.2  4.19  2.1   2.1   2.1  4.19  2.1   2.1 | 4.19  5.15  2.1   2.1  4.19
|4.19  6.29  2.1   2.1   2.1  2.48  4.19  2.1  4.19| 2.1   2.1  6.29  4.19  2.8
 4.19| 2.1   2.1   2.1  4.19  2.1  4.19  6.29  0.66  6.29| 4.19  4.19| 2.1  8.38
 4.93| 2.1   2.1   2.1   2.1 | 4.19  4.19| 2.1  6.29  0.66  4.19  2.1  6.29  2.1
 6.29| 2.1  6.95  2.1   2.1   2.1  4.19| 2.1  4.19  2.1 | 2.1  4.19  4.87  2.1
 4.19  2.1   2.1   2.1  4.19  2.1
```

Every value is a multiple of ~2.096 Mbps = **256 KiB**. Delivery is batched.

Recovery in the 3 s after each gap, as a multiple of the median second:

```
 9.8s → 2.45x    14.8s → 3.00x    23.8s → 3.00x    29.8s → 2.00x
38.8s → 3.99x    40.8s → 3.99x    43.8s → 1.00x    47.8s → 3.00x
49.8s → 3.00x    57.8s → 3.31x    63.8s → 2.00x    66.8s → 2.32x

mean peak/median after a gap: 2.75x
```

**A catch-up burst follows every gap.** If a 2-second segment had genuinely been
dropped, there would be nothing to catch up on. The bytes were late, never
missing — which falsifies the dropped-segment reading outright.

### A.8 Run F — four feeds, 60 s each, with the corrected metric

Re-run after replacing the stall count with `bufferFloorSeconds`.

| | `2449` | `46028` | `241362` | `241363` |
|---|---|---|---|---|
| time to first byte | 725 ms | 960 ms | 997 ms | 940 ms |
| delivered | 21.4 MB | 41 MB | 37.5 MB | 24.7 MB |
| mean Mbps | 2.85 | 5.47 | 5.00 | 3.29 |
| chunk size | ~16 KiB | ~16 KiB | ~16 KiB | ~16 KiB |
| quiet >1.5 s | 4 | 0 | 0 | **10** |
| **prebuffer needed** | **0.08 s** | 0.16 s | 0.15 s | 0.12 s |
| worst shortfall | 27 KiB @ 0.2 s | 105 KiB @ 0.3 s | 90 KiB @ 0.3 s | 49 KiB @ 0.2 s |

Gap rhythm — `2449`: every ~17 s, each ~2002 ms, spread 22 ms. `241363`: every
~5 s, each ~1998 ms, spread 32 ms.

**The conclusion that survived.** `241363` had ten quiet windows and never put a
player more than 0.12 s behind; `2449`, the feed that had been demoted, needs the
least buffer of the four. No feed measured is starving the player, and the number
of quiet windows does not predict the prebuffer requirement at all.

The 16 KiB chunk size against the 256 KiB per-second quantum means one burst is
~16 network chunks.

### A.9 Browser runs — both failed for an environmental reason

`run.mjs compare --stream=2449 --stream=3177 --live --seconds=75`:

```
both streams:  startup NEVER STARTED   played 0s of 75s
               <video> present: false  media requests: 0
```

Not a feed result. The bundled headless Chromium has no H.264/AAC decoder, so
every browser-driven scenario reports this. **Nothing about what the player does
with the bytes has been observed in this environment** — only what arrives. This
run also cost 150 s of the single-slot line for nothing, because the README
advertised `compare` as the feed-comparison scenario.

### A.10 mpegts.js 1.8.1 source — read, not measured

`IOController._onLoaderChunkArrival`, from the dist (no source is published):

```js
if (this._enableStash) { /* accumulate, dispatch when full */ }
else if (this._stashUsed === 0) {
    consumed = this._dispatchChunks(chunk, byteStart);   // immediately, on arrival
    if (consumed < chunk.byteLength) { /* keep only the unconsumable remainder */ }
}
```

Constructor: `this._stashInitialSize = 65536`, replaced directly by a configured
value; `this._bufferSize = Math.max(this._stashSize, 3145728)`.

Conclusions: with the stash disabled every chunk is dispatched on arrival with no
wait or timer; `stashInitialSize` is **bytes** so `128` means 128 bytes; and it is
inert while the stash is off. See M9.

### A.11 HLS viability, for §7b

Manifest fetched from `playbackUrl`:

```
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:1087
#EXT-X-ALLOW-CACHE:YES
#EXT-X-TARGETDURATION:10
#EXTINF:10.000000,      × 6 discrete segments
```

Genuinely segmented, and the provider permits caching explicitly.

Two viewers resolving the same channel independently:

```
manifest tokens equal : NO
segments v1=6  v2=6  byte-identical URLs in common = 0
```

Every viewer receives unique signed URLs for the same six segments, so
`caches.default` cannot dedupe them unkeyed.

### A.12 What each run cost the line

Nine live transport runs plus one wasted browser pair, roughly 19 minutes of the
single slot in total. Every one was taken from a real viewer. The `--live` lock
file and the 180 s cap held throughout; no two ran concurrently.
