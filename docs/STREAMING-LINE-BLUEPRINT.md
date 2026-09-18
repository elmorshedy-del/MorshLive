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

### Reading order — this document contains retractions

It was written across several days and **several of its conclusions were later
overturned by its own measurements.** Retracted claims are kept, marked, rather
than deleted, because the reasoning that produced them is instructive. Read in
this order:

1. **§0.5** — the symptom, in the owner's words. Everything must explain this.
2. **Appendix D** — the 2026-09-18 chain, and the current state of knowledge.
   **D.0 is a map of what each step overturned; D.10 is what stands today.**
3. **§1–§8** — the architecture and the mechanism catalogue. Accurate on the code,
   but §1's central premise is falsified (see D.6) and several mechanisms are
   assessed against assumptions that no longer hold.
4. **Appendices A–C** — the raw record of earlier measurement, including runs that
   produced wrong conclusions.

If you only read one thing, read **D.0 and D.10**.

---

## 0.5 The symptom, in the owner's own terms

**[REPORTED — the owner, corrected 2026-09-17]** The observation every hypothesis
has to satisfy. It is not one pattern but three:

| Pattern | Frequency | What it points at |
|---|---|---|
| **Site and Lab drain together** | most common | Something shared: the provider, the Worker, the line itself |
| **The site drains; the Lab is fine** | rarer | Something **site-only** — M1-M5 |
| **Within a Lab drain, only beIN and some channels; others play fine** | noticed recently | Something **per-channel** |

**The reverse of pattern 2 does not happen.** The owner is explicit: it is never
the Lab draining while the site plays. An earlier revision of this document
recorded the opposite, on an ambiguous reading of "rarely ever it's only website
and just lab", and an independent evaluation then built its headline finding on
explaining a symptom that does not exist. **Do not reintroduce it.** If the Lab is
draining, the site is draining too.

That direction matters because it points the opposite way. A fault that takes the
*complex* page while sparing the *simple* one is the ordinary shape: the site has
the 20 s remount tick, the continuity guard, the premium toggle, the toolbar and
the match machinery, and the Lab has none of them. **Pattern 2 is direct evidence
for the site-only mechanisms M1-M5**, which this document had started to treat as
unlikely.

Pattern 3 is the newest and the least explored: during a Lab drain, some channels
fail while others play normally, in the same session, at the same moment. That is
a strong discriminator — it rules out anything that would affect the line as a
whole, and points at something specific to the feed or to how a particular
channel is resolved and fetched.

**Beware of reasoning from a single session.** Three distinct patterns is good
evidence that more than one mechanism is in play. A fix that resolves one will
look like it failed when the next appears, and one that lands on a quiet evening
will look like it worked (§1, Sep 13). Always establish **which pattern** before
reasoning about a report. There is no incident recorder; establishing which
pattern is on the owner, and D.11 explains why that cannot be inferred from logs.

### A note on the Lab's HLS excursion

`assets/js/iptv-lab.js:563-572` makes the Lab, on the first mid-stream TS error
after playback has started, release the TS connection and switch to HLS — a path
the same file documents at `:64-71` as measured-broken through the proxy (manifest
200, **every segment 403**, because the panel binds segments to the IP that
fetched the manifest and a Worker egresses each subrequest from a different edge
IP).

**This is a real defect** and it is worth fixing on its own merits: it surrenders
the only connection to a path known to fail, then retries hard before returning.

**But it is not the explanation for pattern 2**, because pattern 2 runs the other
way. It was proposed as such while this document had the direction inverted. It
may contribute to pattern 1 — both pages draining together — since a Lab
surrendering the slot mid-incident makes the site's recovery harder, and vice
versa. Unproven.

---

## 1. The constraint that explains most failures — **[FALSIFIED 2026-09-18]**

> **STOP. Read D.6 before this section.** Its central claim was tested on
> 2026-09-18 and is false: the line served **five concurrent streams**, same
> channel and different channels alike, and `activeConnections` reported `0/1`
> throughout. `max_connections: 1` is what the panel *claims*, not what the line
> *enforces*. Everything below was believed on the strength of that field and
> never tested; the contention reasoning built on it does not hold, and the
> capacity advice derived from it is void. The section is kept intact because a
> great deal of this document reasons from it and the reader needs to see what
> was assumed.

**The provider line permits ONE concurrent stream.** *(claimed by the panel;
falsified in practice — see D.6)*

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

**Consequence for buying capacity:** **[WITHDRAWN — see D.4 and D.6]** This section's
sizing advice is superseded by measurement. In a real three-hour incident the
failure rate was flat at ~48-55% whether one client or five were active, and a
client alone still failed 52%. Buying connections cannot fix a failure rate that
does not depend on concurrency, and D.6 shows the ceiling itself is not real.
Read both before acting on anything in §1.

**[DISPUTED — see B.4]** This section originally concluded "roughly 6-8
connections, ghosts included". The independent evaluation rejects that sizing:
this table counts **requests**, which breaks this document's own rule that byte
counts answer "who is using the line". A working session is one long request; a
failing session is thousands. So every bucket is dominated by sessions already in
a retry storm, and the solo bucket is special only because a solo storm has no
other traffic to dilute it. **Buy 2 and observe** rather than sizing from this
table.

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

**Read M9 first** — for what it rules out and for the mistake it records. Note
that its own headline conclusion was later found unsupported; see Appendix B.

**No mechanism in this section is confirmed.** Every one is inferred from reading
code and not one has been instrumented.

**[CORRECTED 2026-09-17]** An earlier revision claimed "none of M1-M7 can explain
a drain that reaches the Lab as well as the site — the Lab has none of them",
and turned that into an open question. **That was a code-reading error**, caught
by the independent evaluation:

- **M6 is duplicated verbatim in the Lab** — `iptv-lab.js:574` carries the same
  uncapped 700 ms-after-first-play reconnect as `watch-lab-continuity-guard.js:168`.
- **M7 is server-side.** The proxy has no idle watchdog for *either* page.
- **M8 is server-side.** A leech pulls through `/api/xtream/media`, which both use.

So three of these mechanisms reach both pages and the question was never open.
M1-M5 *are* site-only, and per §0.5 pattern 2 — the site draining while the Lab
plays — that makes them **more** relevant, not less.

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

**[VERIFIED 2026-09-17] The Lab carries the same loop**, written separately:
`iptv-lab.js:574` — `const delay = tsEverPlayed ? 700 : Math.min(800 * tsStartupFailures, 2400)`.
Same flat 700 ms, same uncapped-after-first-play shape. **M6 is therefore not
site-only**, and a flat 700 ms retry forever is a denial of service against a
one-connection line.

**[MEASURED 2026-09-18] Observed in a real incident.** During the Sep 16 drain
most clients re-requested a *small number* of media tokens dozens to hundreds of
times — one token 233 times, another 190 — with a near-exact 1:1 split of success
to timeout. That is this loop, reusing the media URL without re-resolving the
channel. See D.5. First runtime evidence for M6.

**Symmetric across all cards.** It does not differ between fixtures, so it never
explains why one card drains and another does not — but it shapes what a drain
*looks like* once started.

### M7 — No idle watchdog on the proxy

**[VERIFIED]** §2 Stage 6. Plus `TOKEN_TTL_SECONDS = 6 h`
(`backend/adapters/xtream.js:8`).

**[THEORY]** An abandoned upstream can hold the single slot until the runtime
propagates a cancel, so every duplicated or abandoned mount costs more than it
did while `XTREAM-IDLE-WATCHDOG-1` was in place.

### M9 — Bursty delivery is normal; the rest of this entry is UNSUPPORTED  ← read Appendix B with it

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

### Option D — fix the recovery logic instead (added from B.6)

Proposed by the independent evaluation and **not** among the original three. It
builds nothing: delete the Lab's TS→HLS excursion, back off and cap both 700 ms
reconnect loops, and relax `labChannelAlreadyHealthy`. Hours of work, no
infrastructure, no recurring cost.

Its argument is that the drain is manufactured by a *handover* — on a line with
one connection and no queue, every recovery path drops the connection and
re-asks, and whoever asks first wins. **D is required regardless of whether B is
built**, because fan-out without it merely moves the retry storms onto the
Durable Object.

**[MEASURED 2026-09-18] Option A is not viable.** The claim at
`iptv-lab.js:64-71` was re-verified against production: the manifest returns
**200**, one referenced segment returns **403**. The panel binds segments to the
IP that fetched the manifest and a Worker egresses each subrequest from a
different edge IP. A.11's "zero URLs in common" is a token-keying problem and is
solvable; this is a provider binding and is not. **Do not plan work on A without
first changing that constraint.** See C.3.

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
| What explains a Lab + site drain | **Answered — see D.7.** A transient per-feed provider failure hits both surfaces when they share the failing feed, and all 40 of today's matches route to one channel. The earlier claim that "M1-M7 are site-only" was a code-reading error (M6 is duplicated in the Lab; M7 and M8 are server-side). |
| Player-side behaviour under a real decoder | **Partly resolved.** Branded Chrome 153 is installed and H.264 decode is proven (C.2), so the H.264 feeds can now be driven in a real browser — that experiment has not yet been run. HEVC remains impossible here, so nothing about the `7053` path or iPhone Safari can be tested. |
| Last-mile delivery | Every transport measurement so far is from a datacentre. Nothing is known about delivery to a phone on a mobile network, which is what most viewers use. |
| Wrong `[MEASURED]` claims shipped — **four now** | M9 asserted dropped segments and drove a change to a stream-locked file (reverted). `bufferFloorSeconds` then replaced it and was itself void (B.1). §1's one-connection ceiling was believed untested for the whole investigation (D.6). A live "incident" was the owner browsing (D.9). **See D.11 for the single root cause they share.** |
| `alternates` is read by nobody | `resolveXtreamChannel` computes and returns it, and **zero** client code consumes it. There is no failover today — a bad feed is simply played. |
| `alternates` contains wrong channels — **now worse** | **[VERIFIED]** Of 23 candidates for `bein-sports-1`, **seven are wrong-language** and three are a different broadcaster (Alkass). The provider's 2026-09-18 rename put English and French at positions **3 and 4**, because the filter tests for `english`/`fra` and the names now say `EN`/`FR`. Turkish has a token check; English and French never got one. See D.8. Harmless only while nothing reads the list; **fix before any failover work.** |
| Other channels never health-checked | No channel other than beIN 1 and Thmanyah has had its pick measured. Less urgent than it was: **all 40 of today's matches route to `bein-sports-1`** (D.7), so one feed carries the whole site. |
| Quality parsing broken by the rename | **[VERIFIED]** `FHD` is not a recognised marker, so the 1080 and HEVC feeds parse as `sd` and rank below plain HD — and below the permanently-dead `4905`. See D.8. |
| What produces the 403s | **[UNKNOWN]** Two code paths emit 403 and they are not separable by response size. The expired-cached-token theory is refuted (D.9). |
| `ssc-1/2/3` can never resolve | The provider carries **zero** SSC streams. The ids are dead weight that would 404 if a card used them. See D.8. |

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

---

## Appendix B — independent evaluation, 2026-09-17

A second agent was given this document, its raw appendix, the three fan-out
options and an explicit brief: treat the author as fallible, re-derive from the
numbers, and audit the *instruments* rather than only the reasoning. It was told
the author had reached confident wrong conclusions three times that day.

Its findings are recorded here because several of them **overturn claims still
made elsewhere in this document**. Where its claims were verified against the
code they are marked; where the author disputes them, that is stated too.

### B.1 The headline: `bufferFloorSeconds` measures the startup transient

**[VERIFIED — this voids M9's conclusion]**

Every feed in A.8 reports its worst shortfall at **0.2–0.3 s**. That is not four
independent results; it is the metric measuring the opening ramp before enough
bytes had landed to satisfy a line drawn from t=0.

The arithmetic checks exactly. `2449` at 2.85 Mbps = 356 KB/s; the reported
27 KiB shortfall ÷ 356 KB/s = **0.078 s** → the "0.08 s" in the table. Meanwhile
A.7 shows second 2 of Run E delivering **55.2 Mbps** — roughly 17 seconds of
content banked at once. Once a surplus that size exists, **no later gap can ever
register**, because the model takes the maximum of `consumed(t) − held(t⁻)` and
that maximum is fixed in the first half-second.

So the document's proudest line — *"`241363` had ten quiet windows and still
never put a player more than 0.12 s behind... the number of quiet windows does
not predict the prebuffer requirement at all"* — is an instrument artifact read
as a fact about feeds. **M9's conclusion that the transport is fine is
unsupported.** It may still be true. It is not shown.

**Also circular, as the author suspected.** Consuming at the feed's own mean
delivered rate pins both ends of the curve together, making the metric
scale-invariant: it measures deviation from the feed's own trend and never the
*level* of that trend. **It is structurally blind to sustained under-delivery** —
a feed running at 60% of its encode rate for the whole window scores ≈0. That is
exactly the shape contention or upstream shaping would take.

**The non-circular replacement** is to parse PCR out of the transport stream and
compare media-seconds delivered against wall-clock seconds elapsed. That has an
absolute reference. Nothing in the toolchain looked at a single TS byte.

**Author's correction to the evaluator:** it proposed re-running the model
offline over "arrival arrays already captured with `--json`". No run ever passed
`--json`, so those arrays were never written. That test needs a fresh capture and
is **not** free.

### B.2 Further instrument defects

- **[VERIFIED] `stallMs = 1500` makes quiet-window counts a function of bitrate,
  not health.** With a fixed ~256 KiB delivery quantum, inter-flush spacing
  scales inversely with rate. In A.8 the two fastest feeds (5.47, 5.00 Mbps) have
  **zero** quiet windows and the two slowest (3.29, 2.85) have **all fourteen**.
  A fixed-time threshold against a fixed-byte quantum produces that mechanically.
  §6 Step 0's advice to "read the gap rhythm" rests on a metric whose sensitivity
  varies with the feed being measured.
- **[VERIFIED] `gapRhythm`'s period verdict is near-unfalsifiable.** The length
  tolerance is earned — observed spread 22–92 ms against a 300 ms allowance. But
  the period tolerance `max(2, typicalPeriod * 0.25)` is in **seconds**, so for
  any period under 8 s the 2 s floor dominates: for `241363` (gaps every ~5 s)
  that is ±40%. And `measureTransport` returns `gaps.slice(0, 12)`, so
  `gapRhythm` only ever sees the **first twelve** — the cadence of a long run is
  judged on its opening, while `stallCount` uses the full array. The two disagree
  by construction on long runs.
- **[VERIFIED] A stream that dies mid-run reports as healthy.** If upstream
  closes at 20 s of a 60 s run the loop simply ends, `elapsed ≈ 20`, the mean is
  computed over 20 s, no `error` is set, and the verdict prints **"EASY — any
  sane buffer rides this out."** The only tell is the printed duration. Given
  that "the stream dies" is the actual symptom under investigation, the
  instrument has no signal for it. A.2 caught it by eye, not by the tool.
- **`Number(args.seconds)` → NaN** makes `setTimeout(abort, NaN)` fire
  immediately and the belt-and-braces guard `now - started > (NaN+5)*1000` never
  fire. A mistyped `--seconds` yields a ~0-length run that still costs a
  connection setup.
- **`takeLock()`** tests a possibly-recycled PID with `process.kill(pid, 0)`, and
  the `catch` path drops a lock this process may not own.

### B.3 The safety interlock has a hole

**[VERIFIED]** `harness.mjs:25` blocks `/api/xtream/media`, `/api/xtream/direct`
and `/wk/hls`. It does **not** block `/api/iptv-lab/probe`, which is a real route
(`backend/routes/iptv-lab.js:12,44`) reaching `probeMediaUrl`
(`backend/adapters/xtream.js:328`) — and that fetches a real manifest, a real
segment and a real TS body. **A run without `--live` can still take the slot** if
anything on the page triggers a probe, and on the Lab both `iptv-quality.js:131`
and `iptv-lab-compat-fallback.js` fire probes on `kz:iptv-playback-failed`.

Confirmed safe by contrast: `/api/iptv-lab/status` only probes channels when
`media=1` is passed. §6 Step 2's curl is fine; `?media=1` is a footgun.

### B.4 Where it disputes §1's ghost reading

**[UNRESOLVED — the author finds this persuasive but it is not settled]**

§1's failure-rate table counts **requests**, which breaks this document's own
rule that byte counts, not request counts, answer "who is using the line".

The mechanism it proposes instead: a *working* session is one long-lived
`/api/xtream/media` request lasting minutes — one log line. A *failing* session
is the flat 700 ms reconnect loop — thousands of log lines an hour. So
per-request failure rate is dominated by sessions already in a retry storm, in
every bucket. What makes the "1 viewer" bucket special is that a solo retry storm
has no other traffic to dilute it — **the storm is the bucket**. 3,137 requests
attributed to one viewer is itself the signature of a loop; a healthy solo hour
should produce single-digit requests.

Causality may also run backwards: when a drain clears the room, the last person
left is alone. "Alone" is partly an *effect*.

**Consequence: the "roughly 6–8 connections" sizing in §1 is not supported by
that evidence.** More connections may still be right, for the different reason in
B.6.

On genuine slot-holding it judges M7 real but small: the Worker's
`cancel(reason) { return reader.cancel(reason); }` does propagate to the upstream
subrequest, and the genuinely unreleased cases are narrow —
`xtream-media-safe.js:180-186` returns an error without cancelling
`response.body`, and `fetchXtreamMedia:40-51`'s no-Range retry abandons the first
response body. Both small-body cases. **Do not size a subscription on M7.**

### B.5 Two theories it ruled out from the library source

Recorded so nobody spends a day on either:

- **lazy-load suspend/resume cannot fire.** `notifyBufferedPositionChanged` is
  gated on `!this._config.isLive && this._config.lazyLoad`. Both pages set
  `isLive: true`, so the 180 s→30 s suspend/resume cycle — which *would* close
  and reopen the upstream connection periodically, on both pages — never runs.
- **MSE quota exhaustion cannot occur.** `MSEController`'s constructor forces
  `autoCleanupSourceBuffer = true` when `isLive` and it is unset, with 180 s/120 s
  backward trimming. Both pages qualify.

It also independently re-derived and **confirmed every claim in A.10** about the
stash buffer, including that `stashInitialSize` is bytes and that the 3 MB
allocation is unconditional.

### B.6 Its recommendation, and where it differs

**A fourth option — D: fix the recovery logic. No infrastructure.**

Its argument is that the drain is manufactured by a *handover*: on a line with
one connection and no queue, every recovery path here responds by dropping the
connection and re-asking, and whoever asks first wins. Three changes:

1. **Delete the Lab's TS→HLS excursion** (`iptv-lab.js:563-572`) — it surrenders
   the connection to a path the same file documents as 403ing on every segment.
2. **Back off and cap both 700 ms reconnect loops**
   (`watch-lab-continuity-guard.js:168`, `iptv-lab.js:574`) — 700 ms → 1.4 → 2.8,
   cap ~10 s. A flat 700 ms forever is a denial of service against your own line.
3. **Relax `labChannelAlreadyHealthy`** so a rebuffering player is left alone —
   the M1 fix already designed in §4 and never applied.

It argues D is **required regardless**: fan-out without it just moves the retry
storms onto the Durable Object.

**On buying connections: buy 2, not 6-8.** Its framing is that the second
connection's value is not a second viewer — it is that **a handover stops being a
race**, because the new connection can be established before the old one dies.
If that is the mechanism, 2 produces an obvious improvement immediately; if it
produces nothing, the cause is not slot contention, learned for one month's fee.

**On the fan-out options it adds three things §7b missed:**

- **Option A may be impossible, not merely awkward.** `iptv-lab.js:64-71` records
  that provider HLS **segments return 403** through the proxy because the panel
  binds them to the IP that fetched the manifest. A.11's "zero URLs in common" is
  a *token* problem and solvable; this is a *provider* problem and is not. §7b
  never mentions it. **This is the largest gap in §7b.** The claim is a code
  comment and has never been re-verified — worth ~1 s of line to check.
- **A converges on B anyway.** Request coalescing needs a lock, and in Workers a
  lock means a Durable Object.
- **§7b's table overstates B.** "Exactly 1, permanently" is per *channel*. With
  `max_connections: 1`, B still only serves **one channel at a time**. It also
  omits B's failure modes: a DO is a single point of eviction (a restart drops
  every viewer at once, which would look exactly like pattern 1), per-viewer
  backpressure is required so one slow phone cannot stall the tee, and a naive
  byte-tee gives new viewers garbage until the next keyframe — meaning the DO
  must parse MPEG-TS, which is why "no client change, therefore cheap"
  understates it.

**On the stream lock:** it notes the argument for B treats the lock as a law of
physics when it is a process control the owner holds, with a documented approval
path this document passed through twice on 2026-09-17. Choosing a materially
larger infrastructure project to avoid a process step you control is the wrong
trade. It still prefers B over A on engineering merit — but because B removes the
handover race, not because the client is untouchable.

### B.7 What it could not determine

- **Whether the ~2000 ms gaps originate at the provider or in the Worker.** Every
  measurement in Appendix A includes the Worker hop (`transport.mjs` routes
  through `korazero.com`). Untested.
- **Whether provider HLS segments still 403 through the proxy.** Load-bearing for
  option A, and currently only a code comment.
- **Last-mile behaviour.** Unknown, as this document already says.
- **Whether `activeConnections` is ever 1 with no player of ours running.** That
  is the direct ghost test, it is free, and nobody has run it.

### B.8 The one finding invalidated by a later correction

Its headline mechanism for "the Lab drains while the site is fine" — the HLS
excursion surrendering the slot — was built on a symptom that **does not exist**.
The author had recorded the pattern backwards; see §0.5. The owner is explicit
that it is always the reverse: the site drains while the Lab plays.

The underlying code defect is real and independently verified, and it may
contribute to pattern 1. But it does not explain pattern 2, and pattern 2 points
at the **site-only** mechanisms M1-M5 instead.

This is worth noting as a process point: the evaluation was rigorous and still
produced a wrong headline, because one input was wrong. **Check the symptom
before building on it.**

---

## Appendix C — measurement campaign, 2026-09-18

Run under an explicit brief: measure, do not redesign, do not implement
speculative fixes. Every result below states the hypothesis, why the test
discriminates, the method, the raw figure, the interpretation, the alternatives
still open, and a confidence tag.

Tags: **MEASURED** · **VERIFIED CODE** · **SUPPORTED THEORY** · **FALSIFIED** ·
**UNKNOWN**

### C.0 The instrument was rebuilt first

Appendix B showed the previous metric measured its own startup transient and was
circular. Before any live time was spent, the probe was replaced.

`scripts/diagnostics/ts-analysis.mjs` parses the **Program Clock Reference** — the
encoder's own 33-bit 90 kHz counter, carried in the TS adaptation field — and
compares **media seconds delivered against wall-clock seconds elapsed**. That is
an absolute reference and owes nothing to the feed's byte rate, so it can see
sustained under-delivery, which the old metric was structurally blind to.

Also fixed, all verified by test: early close is now a failure rather than a mean
over a shorter window; arrivals, chunk sizes and gaps are kept in full;
`--seconds` is validated (NaN previously produced a zero-length run that still
cost a connection); the lock records pid *and* start time and is released only by
its owner; `--raw` writes the bytes so any figure can be recomputed offline; and
the harness now refuses `/api/iptv-lab/probe`, which fetches real media and could
previously take the slot during a run *without* `--live`.

Writing the tests caught the same bug the old metric had: the deficit was
evaluated only *at* PCR arrivals, so a silence between them was invisible. It is
now scored against the media held *before* each arrival.

### C.1 Feed / source matrix

**Hypothesis tested.** That the feeds the owner sees draining — beIN, and the
H265 family in particular — are under-delivering at the transport level.

**Why it discriminates.** The media clock separates batching (silence, then a
burst that repays the debt) from starvation (media time falls behind real time
and stays behind). Those are indistinguishable in a byte-rate graph and were
exactly what the previous investigation confused.

**Method.** `run.mjs transport --live --seconds=45`, five feeds sequentially,
never concurrently, line confirmed idle at `0/1` beforehand. No browser, no
decoder. Raw bytes written to disk.

| Stream | Codec / family | Origin | Media / wall | Early close? | Sustained deficit? | Result |
|---|---|---|---|---|---|---|
| `7053` beIN Sport 1 H265 | HEVC, cat 560 "beIN Sports H265" | origin-A | **1.3552x** | no | no — worst 0.315 s | **KEEPS REAL TIME** |
| `2449` beIN Sport 1 HD Q | H.264 1080, cat 6 | origin-A | 1.2566x | no | no — worst 0.192 s | KEEPS REAL TIME |
| `46028` beIN Sport 1 FHD Q | H.264 1080, cat 532 "4K" | origin-A | 1.3629x | no | no — worst 0.258 s | KEEPS REAL TIME |
| `3177` beIN Sport 1 HD | H.264 720, cat 6 | origin-A | 1.2592x | no | no — worst 0.196 s | KEEPS REAL TIME |
| `3974` ON E **[EG] control** | H.264, cat 21 Egypt | origin-A | 1.2760x | no | no — worst 0.183 s | KEEPS REAL TIME |

Supporting figures:

| Stream | TTFB | Requested/survived | MB | Mean Mbps | Quiet >1.5 s | Continuity errors | PCR discontinuities | Final deficit |
|---|---|---|---|---|---|---|---|---|
| `7053` | 756 ms | 45 s / 45 s | 49.7 | 8.84 | **0** | 0 | 0 | −15.68 s |
| `2449` | 777 ms | 45 s / 45 s | 16.0 | 2.84 | 6 | 0 | 0 | −11.30 s |
| `46028` | 918 ms | 45 s / 45 s | 36.4 | 6.48 | 0 | 0 | 0 | −15.66 s |
| `3177` | 865 ms | 45 s / 45 s | 23.0 | 4.09 | 0 | 0 | 0 | −11.43 s |
| `3974` EG | 1145 ms | 45 s / 45 s | 11.2 | 2.00 | **7** (longest 6002 ms) | 0 | 0 | −11.33 s |

**[MEASURED] Interpretation.** Every feed delivers media *faster* than real time
— 1.26x to 1.36x — and ends **11 to 16 seconds ahead**. Nothing measured is
starving a player. `7053`, the H265 feed the owner has observed draining, was the
*cleanest* of the five: zero quiet windows, zero continuity errors, zero PCR
discontinuities, 15.7 s of surplus banked.

**[MEASURED] The quiet-window count is confirmed worthless as a health signal.**
The EG control had **seven** quiet windows, one of 6002 ms — more and longer than
any beIN feed — while keeping perfect media time. Had this campaign used the old
metric it would have reported the EG control as the sick one.

**[MEASURED] Origin: one infrastructure, not several.** The proxy forwards no
upstream identifying headers (`xtream-media-safe.js:12-23` passes only
`Content-Range`, `Accept-Ranges`, `Content-Type`), so the upstream host and any
redirect chain are **UNKNOWN** from this vantage point and no amount of API
inspection reveals them. The available substitute is the **PID layout**, which is
an encoder/muxer fingerprint. All five feeds are identical:

```
0x0100 video   0x0101 audio   0x0000 PAT   0x1000 PMT   0x0011 SDT
```

Same numbering on the EG control as on every beIN variant, including H265. **This
does not support a "beIN sits on different upstream infrastructure from EG"
hypothesis.** Labelled origin-A throughout on that basis.

**Alternatives still open.** Identical PID numbering is consistent with one
origin, and also with several origins running identically configured muxers — it
is a fingerprint, not an identifier. And the decisive caveat below.

**[UNKNOWN] — the caveat that governs this whole table.** These five runs were
taken while **nothing was draining**. They are a *baseline*, not an observation of
the fault. They establish what healthy looks like on this line and they rule out
"these feeds are permanently broken"; they cannot rule out that the same feeds
starve during an incident. Confidence: high for the baseline, none for the
incident.

### C.2 Codec capability — the previous browser evidence is void, and now replaced

**Hypothesis tested.** That the 2026-09-17 browser runs said anything about the
feeds.

**[FALSIFIED]** They did not. Playwright's bundled Chromium is the open-source
build without proprietary decoders. Every codec-dependent result from it is void.

**Method.** Branded **Google Chrome 153.0.8010.47** installed via
`npx playwright install chrome`, driven with `channel: "chrome"`. Capability is
claimed in three escalating steps because each can pass while the next fails, and
only the third is evidence. `scripts/diagnostics/codec-check.mjs`.

```
user agent : Mozilla/5.0 (X11; Linux x86_64) … HeadlessChrome/153.0.0.0 Safari/537.36

                         canPlayType     MediaSource.isTypeSupported
H.264 baseline + AAC     probably        true
H.264 high + AAC         probably        true
HEVC / H.265 main        (empty = no)    false
HEVC / H.265 (hev1)      (empty = no)    false
MPEG-TS H.264 + AAC      (empty = no)    true
```

Decode proof, a generated H.264/AAC sample actually played:

```
outcome playing · currentTime 1.16 · readyState 4 · videoWidth 320
decodedFrames 33 · droppedFrames 0 · mediaError null
```

**[MEASURED] H264 BROWSER TEST AVAILABLE** — decode proven, not merely claimed.
Valid for `2449`, `46028`, `3177`.

**[MEASURED] HEVC BROWSER TEST NOT AVAILABLE IN THIS ENVIRONMENT.** Branded
Chrome on this Linux host reports no HEVC at all. Nothing about the `7053` path
may be inferred from a browser here, and **nothing about iPhone or Safari** — a
UA string or a phone viewport is not iPhone Safari and must never be treated as
one.

### C.3 The HLS 403 claim — re-verified

**Hypothesis tested.** That provider HLS segments still 403 through the proxy.
This is load-bearing: it decides whether fan-out option A is possible at all, and
it had never been re-checked since it was written as a code comment.

**Why it discriminates.** One manifest fetch plus one segment fetch through the
production path is the whole question, and costs about a second of line.

**Method.** Resolve `bein-sports-1`, `GET` the manifest, `GET` exactly one
referenced segment, stop.

```
manifest  status=200  bytes=1336
segment   status=403  bytes=18   type=text/plain
```

**[MEASURED — CONFIRMED, unchanged]** The claim at `iptv-lab.js:64-71` holds as
of 2026-09-18. The panel binds segments to the IP that fetched the manifest and a
Worker egresses each subrequest from a different edge IP.

**Consequence: fan-out option A is not viable as things stand.** A.11's "zero
URLs in common" is a token-keying problem and solvable; this is a provider
binding and is not. §7b is corrected accordingly.

### C.4 Cloudflare — what a real incident looks like

**Hypothesis tested.** That during a drain a replacement media request begins
before the previous one has terminated.

**Why it discriminates.** On a line permitting one connection, overlap is the
difference between "two viewers exceeded capacity" and "one client raced itself".
Request *counts* cannot show it; request *timing* can.

**Method.** GraphQL `httpRequestsAdaptive` (individually sampled requests, not
aggregates) on `/api/xtream/media`, 23 h window. `edgeTimeToFirstByteMs` and
`edgeResponseBytes` are not available on this plan, so sequence and status were
used. 207 sampled requests.

**[MEASURED] All three heavy clients are iPhone Safari** (`iPhone; CPU iPhone OS
18_7`), and every one shows the same signature:

| Client | Sampled | Statuses | Starts ≤2 s apart | Median gap |
|---|---|---|---|---|
| `2607:…:4e36` | 63 | 200×28, 504×30, 403×5 | **36/62** | **0 s** |
| `2607:…:311a` | 50 | 200×24, 504×22, 403×4 | 32/49 | 0 s |
| `2607:…:1151` | 36 | 200×14, 504×12, 405×10 | 30/35 | 0 s |

A 200 and a 504 are logged **in the same second, from the same client,
repeatedly**:

```
14:15:45  200      11:07:58  200      03:23:11  200
14:15:45  504      11:07:58  504      03:23:11  504
```

and one client produced 18 requests in 17 seconds mixing 200 / 504 / 405.

**[MEASURED] Answer: yes. The replacement begins before the old one terminates.**
A request that delivered bytes and a request that timed out are open in the same
second from one client. On a one-connection line only one can win.

**[MEASURED] 504 carries zero bytes, always.** In the aggregate query every 504
group summed to 0.0 MB across 23 h. A 504 here is a request that never delivered,
not a truncated delivery.

**[MEASURED] Bytes and requests tell opposite stories, confirming Appendix B.**
Several cloud clients pulled 20–134 MB in **one to five** requests — the healthy
shape, one long-lived request. The three iPhones pulled comparable bytes across
**36–64** requests with roughly half failing. Counting requests would rate the
iPhones as the heaviest users of the line; counting bytes shows they are not.

**Alternatives still open.** Sampling is not exhaustive, so absolute counts are
not reliable — only the *shape* is. `datetime` records request start, and without
duration the overlap is inferred from same-second start plus the 504-with-no-bytes
pattern rather than measured directly. And these clients cannot be attributed: an
iPhone UA is consistent with the owner's own phone and with any viewer.

### C.5 Ghost connections

**Hypothesis tested.** That `activeConnections` stays at 1 with no legitimate
player running, which would be direct evidence of a provider-side lingering
session.

**Method.** Poll `/api/iptv-lab/status` — verified free, it only probes channels
when `media=1` is passed — with no KoraZero player running. No stream opened.

**[MEASURED]** Immediately before the campaign, three polls 4–5 s apart: all
`active 0 / 1`. After the campaign, **30 consecutive polls at 18 s intervals over
roughly nine minutes (00:26:05 – 00:34:47 UTC): every one `active 0 / 1`**, with
no anomaly and no single elevated sample.

So the line releases cleanly and holds at zero when idle. Combined with C.4 — a
504 that carries no bytes, and a replacement request starting in the same second
as one still outstanding — the overlap being observed is **self-inflicted and
short-lived**, not a long-lived provider-side session pinning the slot.

**[UNKNOWN] This does not settle the question.** It shows there was no ghost *at
that moment*, which is the weaker half. The test only pays out when polled during
a reported drain, and it has still never been run then. It costs nothing and
remains the single cheapest outstanding measurement.

### C.6 Hypothesis matrix

Read with §0.5: the owner reports site+Lab together (most common), site-only
(rarer), and beIN-plus-some-channels within a Lab drain (noticed recently). The
reverse — Lab draining while the site plays — does **not** happen.

| Hypothesis | Site+Lab together | Site-only | beIN-only | Evidence now | Falsifier |
|---|---|---|---|---|---|
| Feed under-delivers at transport | ✓ would | ✗ | ✓ would | **FALSIFIED at baseline** (C.1) — all five feeds ≥1.25x real time, H265 cleanest. Not tested during an incident. | A during-incident capture showing media/wall <1 |
| Different upstream origin for beIN vs EG | ✓ | ✗ | ✓ | **Not supported** (C.1) — identical PID layout across beIN and EG | Differing PID layout, or upstream host exposed |
| High-bitrate variants fail, low ones don't | ✓ | ✗ | ✓ | **FALSIFIED** — 8.84 Mbps H265 was cleanest; 2.84 Mbps `2449` gappiest; ladder already showed 4K healthiest (§5) | A capture where deficit tracks bitrate |
| HEVC-specific player/transport path | ✗ | ✓ | ✓ | **UNKNOWN** — transport is clean (C.1); browser cannot test HEVC here (C.2) | An HEVC-capable browser, or an iPhone Safari session |
| Client races itself: replacement before release | ✓ | ✓ | ✓ | **WEAKENED** (**D.9**) — the same-second 200/504 pairing is also produced by a viewer opening and closing the site, so it is not evidence on its own. What survives is D.9's token-reuse split: 77% of the Sep 16 window sits on tokens re-requested 10+ times, which browsing cannot produce. | Ground truth during a confirmed incident showing no repeated re-requests |
| Recovery logic surrenders the slot | ✓ | — | — | **SUPPORTED, code only** — Lab TS→HLS excursion (`iptv-lab.js:563-572`) into a path now re-confirmed to 403 (C.3); uncapped 700 ms loops in **both** pages | Instrumented session showing no HLS excursion before a drain |
| Site-only mechanisms M1-M5 | ✗ | ✓ | — | **M1 now observed at runtime** (**D.5**) — one client used 62 tokens across 163 requests, re-resolving the channel per attempt, which is the remount path. M2-M5 remain uninstrumented. | A site-only drain with no remount and no toolbar churn |
| Two honest viewers exceed the line | ✓ | ✗ | ✗ | **FALSIFIED** (**D.4**, **D.6**) — success is flat across a fivefold change in concurrency, and the one-connection ceiling it assumed does not exist: the line served 5 concurrent streams | A drain whose failure rate tracks 1/N concurrency |

### C.7 The question the campaign was built to answer

> When beIN begins draining while an EG control stays healthy, what is the first
> measurable difference before any KoraZero recovery code runs?

**Not answered, and the reason matters.** Every feed measured was healthy, so
there was no divergence to catch. What the campaign did establish is that the
apparatus to answer it now exists and is trustworthy: an absolute media clock, an
early-close detector, raw capture for offline re-analysis, a PID fingerprint, and
a browser proven to decode H.264.

**The measurement must be taken during an incident.** At baseline the answer is
"no difference" — which is itself worth knowing, because it means whatever
distinguishes beIN from EG during a drain is **not** a standing property of the
feeds.

### C.8 What this campaign cost

Five live pulls of 45 s, about 3.75 minutes of the single slot, plus roughly one
second for the HLS check. No concurrent runs; lock held throughout; line verified
idle at `0/1` before starting. Everything else — catalogue topology, codec
capability, Cloudflare analysis, ghost polling — was free.

---

---

# Appendix D — The 2026-09-18 chain

**From a Google Analytics screenshot to three falsifications.**

## D.0 How to read this chapter

This is one continuous investigation, not four independent findings. Each step
was prompted by the one before it, and **three of them overturned conclusions
reached earlier in the same chain.** Reading them out of order gives the wrong
picture, so the arc is stated first.

| # | Question | Answer | What it cost |
|---|---|---|---|
| 1 | Were the GA traffic spikes caused by our own probing? | **No** — three independent reasons | — |
| 2 | Why did GA session duration collapse when traffic peaked? | Found a **real incident**, Sep 16 19:00–22:00 | — |
| 3 | Is the drain caused by viewers contending for the line? | **No** — failure flat at ~50% from 1 client to 5 | Killed the contention model |
| 4 | Is the 50% a structural artifact (HLS+TS both fetched)? | **No** — one token was re-requested 190 times | Killed the mundane explanation |
| 5 | Is the line really limited to one connection? | **No** — it served **5 concurrent** | **Killed §1**, the premise under steps 3–4 |
| 6 | What actually fails, then? | Caught a **per-feed transient 503** live | Gave a mechanism that fits all 3 symptoms |
| 7 | Which stream does the site even play? | It **changed overnight**, no deploy | Made every "the site plays X" claim dated |
| 8 | Was the session I captured really a drain? | **No** — the owner was opening and closing | Killed my own live-incident claim |

**The single most important line in this chapter is step 8.** It showed that the
signature used to identify a drain in steps 3–5 is also produced by a viewer
browsing normally. What survives that, and what does not, is set out in D.9.

Tags used below: **MEASURED** · **VERIFIED CODE** · **SUPPORTED** · **FALSIFIED** · **UNKNOWN**

---

## D.1 Where it started

The owner sent a Google Analytics screenshot for **Wednesday 16 September**:
average session duration `00:09:01`, up 56.91%, with spikes reaching ~30 minutes
in the morning and early afternoon, then flat at zero from late afternoon
onward. The question was simple: *are those spikes real viewers, or was it us
probing the site over and over?*

## D.2 Step 1 — The spikes were not us

**[MEASURED]** Three independent reasons, none of which depends on the date:

1. The transport probe is Node `fetch` — no browser, no JavaScript. It cannot
   create a GA4 session under any circumstance.
2. The browser runs served HTML from **localhost** (the diagnostics harness
   proxies only `/api/*`), so production never logged a page view from them.
3. `gtag.js` **failed to load** in those runs — `net::ERR_FAILED` on
   `googletagmanager.com` appears in the harness output. No GA script, no session.

And independently: Sep 16 predates the diagnostics harness, first committed
2026-09-17.

**What Sep 16 actually was** — 918 HTML page loads, split by whether the client
can run JavaScript at all (and therefore appear in GA4):

| | Count |
|---|---|
| Real browsers (can register in GA4) | **346** |
| Bots / curl / non-JS (cannot) | 572 |

Real-browser traffic by hour, UTC:

```
13:00  ######  6        18:00  #############################  29
14:00  ####    4        19:00  ########################       24
15:00  #####   5        20:00  ######################################## 141
16:00  ###################  19   21:00  ####################################  76
17:00  ######  6        22:00  ###########  11
```

From Oman, Saudi Arabia, Morocco, Algeria, Tunisia and Qatar — a genuine MENA
audience concentrated at match time. The 572 non-JS loads are mostly PetalBot
(six Singapore IPs) and curl from Azure, invisible to GA4.

**[MEASURED] But the spikes themselves are thin.** In the hours where the chart
peaks at 25–30 minutes, Cloudflare shows **1 to 6 real-browser page loads per
hour**. An average over one or two sessions is one number, not a trend, and a
single phone left open on a watch page produces exactly that shape.

**[UNKNOWN]** The GA property's timezone is unconfirmed. The owner believes UTC
but is explicitly unsure, so the chart's x-axis cannot be aligned to the hours
above with certainty.

---

## D.3 Step 2 — A contradiction led to a real incident

If the GA chart is UTC, it contains a contradiction: session duration collapses
to ~zero from late afternoon, while the table above shows that period was the
**busiest** real-browser block of the day. The media layer explains it.

**[MEASURED]** `/api/xtream/media` by hour, 2026-09-16 UTC:

| Hour | 200 | 504 | 403 | Success | MB |
|---|---|---|---|---|---|
| 13:00–17:00 | 1–7 per hour total | | | mixed | small |
| 18:00 | 8 | 2 | 0 | 80% | 2,598 |
| **19:00** | 170 | 164 | 0 | **50%** | 4,913 |
| **20:00** | 232 | 247 | 20 | **45%** | 2,390 |
| **21:00** | 248 | 268 | 25 | **42%** | 2,692 |
| 22:00 | 14 | 24 | 10 | 24% | 207 |
| 23:00 | 28 | 27 | 6 | 35% | 366 |

Morning hours carried one to seven media requests each. The evening carried
**400–500 per hour**, with roughly half failing for three consecutive hours.
That is not a hundredfold increase in audience.

**Who was there — [MEASURED]** 14 distinct clients, from Saudi Arabia, Palestine,
Morocco, Oman (two), Qatar, Germany, Tunisia, Algeria and the US:

| Client | Country | Requests | 200 | 504 | Starts ≤2 s apart |
|---|---|---|---|---|---|
| `2001:16a2:…` | SA | 82 | 44 | 38 | 33/81 |
| `1.178.122.237` | PS | 75 | 37 | 34 | 36/74 |
| `105.72.205.254` | MA | 55 | 26 | 29 | 23/54 |
| `2607:fb91:…` | US | 55 | 23 | 26 | 33/54 |
| `145.224.121.47` | OM | 51 | 23 | 21 | 23/50 |
| `145.224.121.242` | OM | 48 | 25 | 21 | 23/47 |
| `2a02:9b0:…` | SA | 44 | 22 | 21 | 15/43 |
| `2a04:7f80:…` | QA | 40 | 20 | 19 | 16/39 |

A real audience, not one leech and not one agent. **Every client shows ~50%
failure and 40–60% of consecutive requests starting within two seconds.**

**⚠ Read D.9 before drawing conclusions from the "starts ≤2 s apart" column.**
That marker was later shown to be produced by ordinary browsing as well.

---

## D.4 Step 3 — Contention falsified

**Hypothesis.** Failures are caused by viewers competing for the single
connection.

**Why this test discriminates.** If one slot is shared strictly among N
simultaneous clients, the share of attempts that succeed should fall as 1/N.

**Method.** 500 individually sampled requests in the window, bucketed by how many
*distinct* clients started a request in the same minute. Cloudflare only; no
stream opened.

| Clients that minute | Minutes | Requests | Success | Predicted if 1 slot |
|---|---|---|---|---|
| **1 — alone** | 17 | 33 | **48%** | 100% |
| 2 | 31 | 173 | 51% | 50% |
| 3 | 14 | 166 | 48% | 33% |
| 4 | 7 | 106 | 48% | 25% |
| 5 | 1 | 22 | 55% | 20% |

**[FALSIFIED as the primary driver] Viewer contention.** The curve is flat across
a fivefold change in concurrency where a steep decline was predicted. A client
**alone on the line still failed 52%** of its requests.

**This vindicated a claim the owner made repeatedly and this document had twice
dismissed** — that multiple viewers had often coexisted with no drain.
Concurrency is not what determines whether requests fail.

**Consequence:** §1's "roughly 6–8 connections" sizing was withdrawn. Appendix B
had already rejected it on reasoning; this rejected it on measurement.

---

## D.5 Step 4 — The mundane explanation eliminated

**Hypothesis.** The ~50% is structural rather than a race: `getIptvLabChannel`
returns **both** an HLS and a TS playback URL (§2 Stage 4). A page fetching both
would produce a 2:1 failure mechanically, with no loop involved.

**Why this test discriminates.** The two models predict opposite things about
**requests per token**. Structural: two tokens, each fetched about once, one
consistently failing. Retry churn: few tokens, each fetched many times.

| Client | Tokens | Requests | Req/token | Busiest single token |
|---|---|---|---|---|
| `2001:16a2:…` | 7 | 289 | **41.3** | **233 requests** — 123×200, 110×504, 1,051 MB |
| `2a04:7f80:…` | 2 | 193 | **96.5** | **190 requests** — 97×200, 92×504, 693 MB |
| `41.188.108.209` | 17 | 248 | 14.6 | 60 — 34×200, 26×504 |
| `1.178.122.237` | 4 | 96 | 24.0 | 39 — 20×200, 19×504 |
| `105.72.205.254` | 6 | 110 | 18.3 | 50 — 22×200, 28×504 |
| `2a02:3038:…` | 6 | 91 | 15.2 | 61 — 31×200, 30×504 |
| `145.224.121.47` | 11 | 105 | 9.5 | 29 — 11×200, 18×504 |
| `2607:fb91:…` | **62** | 163 | **2.6** | 6 |

**[FALSIFIED] The structural explanation.** One token was requested **190 times**
and another **233**. Two URLs fetched once each cannot do that.

**[MEASURED] Two distinct client behaviours, not one.** Most clients hammer a
*small number of tokens*, which is a reconnect reusing the media URL without
re-resolving — **M6**. The US iPhone is the opposite: **62 tokens for 163
requests**, a new token per attempt, meaning it re-called
`/api/iptv-lab/channel` every time — the full remount, **M1**. Both are visible
in the same incident on different clients. This is the first runtime evidence for
either; both were previously code-reading only.

**[MEASURED] Bytes flow throughout.** One token carried 1,051 MB across its 233
requests — video arriving in bursts between failures.

---

## D.6 Step 5 — §1 itself falsified: there is no one-connection limit

**2026-09-18 02:05–02:25 UTC. Line reporting idle, zero media requests in the
preceding 45 minutes, no viewers present.**

**Prompted by the owner**, who proposed a refinement: perhaps the limit is **per
stream** rather than per account, so a crowd on one channel is fine and only two
*different* channels collide. Cloudflare cannot answer it — every dimension that
identifies a channel (`clientRequestQuery`, `clientRefererHost`) is blocked on
this plan — so it was tested directly.

| Test | Setup | Result |
|---|---|---|
| A | one connection alone | served |
| B | **two concurrent, same stream** | **both served** |
| C | **two concurrent, different streams** | **both served** |
| D | **three concurrent, different streams** | **3/3 served** |
| E | **five concurrent, different streams** | **5/5 served** |

Five simultaneous pulls delivered 8.3, 11.3, 28.4, 9.3 and 3.7 MB in 15 seconds.

**[FALSIFIED] `max_connections: 1` is not enforced as reported.** Neither the
per-account reading nor the owner's per-stream reading survives.

**[MEASURED] `activeConnections` does not track reality.** It reported `0/1`
*while five streams were being pulled*, and `1/1` at moments when nothing ran.

### What this invalidated

- **§1's central claim** — "two honest viewers at once degrade each other" — and
  with it the framing that a drain is "something asked for a second connection".
- **The ghost test (C.5).** Thirty polls of `activeConnections` measured a
  counter that does not reflect connections. Its clean result says nothing.
- **Every capacity recommendation in this document.**
- **The fan-out case in §7b**, whose value was collapsing N connections against a
  hard ceiling that does not exist.
- It also **explains D.4 rather than contradicting it**: the failure rate was flat
  across concurrency because there is no contention to escalate.

### Limits

Tested at 02:0x UTC with no other viewers; enforcement could differ under load or
may have changed over time. Each pull was 15–20 s. **Instrument caveat found
here:** `mediaPerWall` on 15–20 s pulls is dominated by the opening burst and
read 13× and 19× in these runs — it is meaningful only at 45 s or more.

---

## D.7 Step 6 — What replaces it: transient per-feed failures

The connection-limit experiment's **baseline pull failed**, which is how the real
fault was found.

**[MEASURED 02:07 UTC]** Stream `2449` returned **503 to a lone connection on an
idle line**, on every attempt, for roughly two minutes — while `3177` served
perfectly in the same instant. `2449` had pulled 16 MB cleanly three hours
earlier and pulled 3.7 MB cleanly ten minutes later.

A sweep taken during the window:

| Stream | Feed | Status | Result |
|---|---|---|---|
| `2449` | beIN 1 H264 1080 | 200 | recovered — KEEPS REAL TIME |
| `3177` | beIN 1 H264 720 | 200 | KEEPS REAL TIME |
| `46028` | beIN 1 H264 1080FHD | 200 | KEEPS REAL TIME |
| `7053` | beIN 1 HEVC 8M | 200 | KEEPS REAL TIME |
| `4905` | beIN 1 low 512K | 200 | **EARLY CLOSE at 0.51 s** |
| `241362` | Thmanyah 1 1080 | 200 | KEEPS REAL TIME |
| `3974` | ON E [EG] | 200 | KEEPS REAL TIME |

`4905` dying at 0.51 s reproduces the Sep 17 ladder exactly (§5) — that feed is
permanently broken, not intermittently.

**[SUPPORTED] The provider intermittently fails individual streams, briefly.**
Per-feed and time-varying — not capacity, not contention, not codec, not bitrate.

**Note:** `2449` and `3177` are **both beIN Sports 1**, two encodes of the same
channel. So this was one variant failing while another variant of the identical
channel served. The fault sits at the individual stream.

**It fits all three symptom patterns (§0.5) with no further assumption:**

| Pattern | Explanation |
|---|---|
| Site **and** Lab together | both on the feed that is failing |
| Site drains, Lab fine | different channels; only one feed failing |
| Only beIN and some channels | exactly what a per-feed transient fault looks like |

**And the site concentrates the risk.** All 40 matches in `today.json` carry
`channelId: bein-sports-1`. Every viewer, every match, one feed — so a single
feed blip takes down the whole site at once.

---

## D.8 Step 7 — The provider renamed everything

**[MEASURED]** Between 2026-09-17 and 2026-09-18 the provider rewrote the beIN
stream names. Nothing in this repository changed. The resolver reads names, so
its output changed by itself.

| | 2026-09-17 | 2026-09-18 |
|---|---|---|
| picked | `2449` `beIN_1HD_1080p` — 1080 h264 | **`3177`** `beIN Sport 1 HD` — hd h264 |
| alt | `46028` `beIN_SPORTS_1_1080FHD` | `2449` `beIN Sport 1 HD Q` |
| alt | `3177` `beIN_1_HD720` | `3614` `beIN Sport 1 EN HD` |
| alt | `89778` `BeIN Alkass 1 HD` | `32901` `beIN Sport 1 FR HD` |

Three consequences, each verified by running `parseXtreamChannelName` against the
new strings rather than by reading the regexes:

**1. [VERIFIED — live bug] English and French feeds now pass as Arabic.**

```
beIN Sport 1 EN HD   ->  language "ar"
beIN Sport 1 FR HD   ->  language "ar"
```

`lib/xtream-channel-map.js:88-90` tests `/\benglish\b|\beng\b/` and
`/\bfrench\b|\bfra\b/`. The provider now writes the tokens **`EN`** and **`FR`**,
which neither matches. Turkish has a `tokens.includes("tr")` check; English and
French never got one. §8 recorded this as latent on 2026-09-17 — **the rename
made it live.**

Running the resolver against the live catalogue gives 23 candidates for
`bein-sports-1`, of which **seven are wrong-language** and three are a different
broadcaster (Alkass). Positions 3, 4 and 6 are English and French — directly
behind the two Arabic feeds.

**2. [VERIFIED] Quality detection has collapsed.**

```
beIN Sport 1 FHD Q   ->  quality "sd"     (it is the 1080 FHD feed)
beIN Sport 1 H265    ->  quality "sd"     (it is the 8 Mbps HEVC feed)
```

`:112-117` does not recognise **`FHD`**, and the new names dropped the numeric
markers. The best feeds now rank *below* plain HD ones, and below a genuine SD
feed. The known-dead `4905` sits at position 8, above both.

**3. [MEASURED] The site's pick changed with no deploy.** `2449` yesterday,
`3177` today. Identification survived the rename exactly as the file's header
intends; **ranking did not**, because rank is parsed from the same volatile names.

**Accidental consequence, recorded honestly:** the repoint debated at length on
2026-09-17 — moving off `2449` because it measured worse — happened by itself and
landed on `3177`, which measured healthiest of the H.264 feeds. The right outcome
for no good reason, and it can move back just as easily.

**Consequence for this document:** stream ids are stable; names, parsed quality
and therefore the pick are not. **Any statement of the form "the site plays X" is
true only on the date it was measured**, including Appendix C.

### What the front page actually exposes

Checked because of a question about whether H.265 streams were reachable. The
front page emits **channel ids only, never stream ids** — 14 of them:
`bein-sports-1..4`, `bein-max-1..4`, `thmanyah-1..3`, `ssc-1..3`. Stream ids like
`22997` and `7053` appear nowhere in the repository.

- **H.265 is never played.** HEVC scores 0 against H.264's 100, so `22997` and
  `7053` rank 20th and 21st of 23. They are reachable only in the IPTV Lab, which
  lists the whole catalogue by design — and since branded Chrome has **no HEVC**
  (C.2) while iPhone Safari does, a Lab user gets video on a phone and a black
  screen on desktop.
- **`ssc-1/2/3` can never resolve.** Not a resolver gap: the provider carries
  **zero** SSC streams in its 5,477-entry catalogue. Those three ids would 404 if
  a match card ever used them.

---

## D.9 Step 8 — The retraction that reframes steps 3–5

**[MEASURED 2026-09-18 02:2x UTC]** A session was observed live on
`/api/xtream/media` showing every marker this document had been treating as a
fault:

```
02:18:34  504
02:18:34  200      <- paired, 0s apart
02:18:59  200  (+25s)
02:18:59  504
02:19:55  200  (+56s)
02:19:55  504
02:20:56  504 504 200 403 200 403 403 504 403 504 504 403 504 200   <- 14 in 3s
02:25:48  504 200 403 200 504 403 403 504 504 504                   <- 10 in 2s

totals 504×25  200×16  403×15      starts <=2s apart: 46/55      median gap 0s
```

It was reported to the owner as an incident in progress. **The owner replied that
he had simply been opening and closing the site.** Not draining. Browsing.

### Why normal behaviour produces that signature

Opening the page mounts a player and starts a media request. Closing abandons it,
and the abandoned request is logged with **zero bytes** — as a 504. So:

> one open + one close = one 200 and one 504

That is the 1:1 pairing, the same-second overlap and the burst shape, all from a
viewer doing nothing unusual. **None of those markers is evidence of a fault on
its own.**

### What still distinguishes real churn — token reuse

A fresh page load always mints a new media token. A token requested **once or
twice** is consistent with open-and-close; a token requested **ten or more times**
cannot be. Re-cutting the Sep 16 incident on that axis:

| Token reused | Tokens | Requests | Success |
|---|---|---|---|
| 1–2× — consistent with open/close | 56 | 104 | 27% |
| 3–9× — ambiguous | 51 | 232 | 33% |
| **10+× — cannot be open/close** | **27** | **1,103** | **50%** |

**[MEASURED] 1,103 of 1,439 requests — 77% — sit in the bucket browsing cannot
produce.** D.3–D.5 survive on that basis: the Sep 16 window carried genuine
repeated re-requesting of single URLs, at scale.

**The 27% row is withdrawn as ambiguous.** A token used once that never delivered
is equally consistent with a real fault and with a tab closed before the stream
established.

### The hole this exposes

**HTTP status codes do not carry intent.** A 504 with zero bytes means "this
request delivered nothing". It cannot distinguish:

- the provider refused or hung *(a fault)*
- the viewer closed the tab *(normal)*
- the player tore down and reconnected *(the amplifier)*

Nothing available from Cloudflare separates them — `edgeResponseBytes` is zero in
all three, and the timing shape is identical.

**A related discriminator that also failed.** The 403s were investigated on the
theory that they were expired cached tokens (the `LAB_CHANNEL_TTL` bug, §2 Stage
5). **Refuted:** no token only ever 403s — every one that failed also succeeded,
across 20 distinct tokens. An attempt to separate "provider refused" (`Upstream
error 403`, 18-byte body) from "our token failed" (31-byte body) by response size
was **inconclusive**: with headers included both land at ~795–811 bytes against an
observed 826, and "expired" and "invalid" produce identical 31-byte bodies.
**[UNKNOWN] — what produces the 403s is not established.**

---

## D.10 State of knowledge after this chain

### Stands

| Finding | Basis |
|---|---|
| The GA spikes were real viewers, not our probing | D.2, three independent reasons |
| Sep 16 19:00–22:00 carried genuine retry churn | D.9 — 77% of traffic on tokens reused 10+ times |
| Viewer contention is not the primary driver | D.4 — flat across 1→5 clients |
| The failure is not a structural two-URL artifact | D.5 — one token requested 190× |
| **The line is not limited to one connection** | D.6 — 5 concurrent served |
| `activeConnections` is not a measurement | D.6 — read `0/1` during 5 live pulls |
| The provider transiently fails individual streams | D.7 — `2449` 503 for ~2 min while `3177` served |
| M1 and M6 both occur at runtime | D.5 — two client behaviours in one incident |
| `EN`/`FR` feeds now pass the Arabic filter | D.8, verified against the live parser |
| Quality parsing is broken by the rename | D.8 — `FHD` reads as `sd` |
| The site's pick is not stable across days | D.8 — changed with no deploy |

### Dead

- §1's one-connection constraint, and every capacity recommendation from it
- The ghost test as designed (C.5)
- "Same-second 200/504 pairing proves a fault" (D.9)
- The expired-cached-token explanation for the 403s (D.9)

### Open

| Question | Why it is not answered |
|---|---|
| What produces the 403s | Two code paths, not separable by response size |
| How often and how long per-feed 503s last | Caught once, for ~2 minutes |
| Whether the drain is the provider fault or the retry amplifier | Needs ground truth during a confirmed incident |
| Whether concurrency behaves differently under real load | Tested at 2 a.m. with nobody watching |

---

## D.11 The thread running through all of it

Three findings in this chapter overturned earlier ones, and they share a single
root cause:

| Falsified | What was assumed | What was skipped |
|---|---|---|
| The ~2000 ms gaps (M9) | identical gap lengths = dropped segments | checking whether the bytes later arrived |
| The one-connection limit (D.6) | the provider's own API field was true | testing it, once, in twenty minutes |
| The live "incident" (D.9) | the request pattern meant a fault | asking the owner what he was doing |

**In each case a number was read as a symptom without establishing what was
actually happening when it was recorded.** That is the failure mode to guard
against in this document, more than any particular wrong hypothesis.

### The rule that follows

> **Never classify a window as an incident without the owner confirming it was
> one.** Ask which surface, which channel, and whether anything was working.
> Logs describe traffic; only the person watching knows whether it was a drain.

And its corollary for instruments: **a number reported by a system is a claim
about that system, not a measurement of it.** `max_connections: 1` was believed
for the entire investigation because a provider API said so.

---

## D.12 Audit of every recommendation this document has made

Written 2026-09-18, after D.6 falsified the one-connection premise. **Most
recommendations in this document rested on that premise and do not survive it.**
Each is re-judged below against current evidence rather than left standing.

### Dead — do not act on these

| Recommendation | Where it came from | Why it is dead |
|---|---|---|
| **Buy more provider connections** (§1 said 6–8; later revised to "buy 2") | §1's `max_connections: 1` | **D.6** — the line served 5 concurrent. There is no ceiling at 1 to raise. This would have been money spent on nothing. |
| **Fan-out option A** — edge-cache HLS segments | §7b | **C.3 / D.7** — provider HLS segments return 403 through the proxy, re-verified. Not awkward; impossible. |
| **Fan-out option B** — Durable Object teeing one upstream | §7b, endorsed by the evaluator | **D.6** — its entire value was collapsing N connections against a hard ceiling. There is no hard ceiling. |
| **Fan-out option C** — repackage into R2 | §7b | Was always disproportionate; now has no capacity problem to solve either. |
| **`curl /api/iptv-lab/status` during a drain** (§6 Step 2, C.5) | the ghost hypothesis | **D.6** — `activeConnections` read `0/1` while five streams were being pulled. The counter measures nothing. |
| **Re-run `bufferFloorSeconds` offline** | Appendix B.1 | Superseded — the metric is retired (C.0). The media clock replaced it. |

### Weakened — the code defect is real, the *reason* changed

| Recommendation | Original rationale | Status now |
|---|---|---|
| **Delete the Lab's TS→HLS excursion** (`iptv-lab.js:563-572`) | It surrenders the only connection to a path that 403s | **Still worth doing, for a different reason.** Surrendering the connection costs nothing — there is no slot to lose (D.6). But it still abandons a *working* TS stream, waits 180 ms, retries a path re-confirmed to 403 on every segment (D.7), and only then comes back. That is a self-inflicted multi-second gap for no possible benefit. The defect stands; the urgency is lower. |
| **Back off / cap the 700 ms reconnect loops** (`iptv-lab.js:574`, `watch-lab-continuity-guard.js:168`) | The immediate retry collides with the client's own unreleased connection on a one-slot line | **Justification collapsed.** There is no one-slot line, so there is nothing to collide with. What remains is noise: during the ~2-minute per-feed 503 seen in D.7, a 700 ms loop issues roughly 170 futile requests. **And backoff could make things worse** — if the feed recovers after 30 s and the client has backed off to 10 s, the viewer waits longer than they do today. **Genuinely unclear whether this helps. Do not ship it on the old reasoning.** |
| **Relax `labChannelAlreadyHealthy`** — the M1 fix designed in §4 | A remount opens a second connection on a one-slot line | **Weakened but not dead.** The slot argument is gone. M1 *is* now observed at runtime (D.5 — one client used 62 tokens for 163 requests), and remounting a healthy player causes a visible glitch for nothing. But **it has never been shown to cause a drain**, and it touches a stream-locked file. |

### Strengthened — the one case that got better

| Recommendation | Status |
|---|---|
| **Fix the `EN`/`FR` language filter** (`lib/xtream-channel-map.js:88-90`) | **Stronger than when first raised.** It was latent on 2026-09-17; the provider's rename made it live (D.8). Of 23 candidates for `bein-sports-1`, seven are wrong-language, and English and French now sit at **positions 3 and 4** — directly behind the two Arabic feeds. Still harmless only because nothing reads `alternates`. **This is the clearest defect in the codebase with the smallest fix.** |
| **Fix `FHD` quality parsing** (`:112-117`) | New, from D.8. The 1080 and HEVC feeds parse as `sd` and rank below plain HD — and below the permanently-dead `4905`. |

### Tests suggested to the owner — which still stand

| Test | Status |
|---|---|
| **`video.buffered` snippet during a real drain** | **Still the single best test available**, and now more important, not less. Every other avenue has been eliminated; this is the only way to see what the *player* experiences rather than what the network delivers. Unaffected by anything since. |
| **Site and Lab consoles side by side during a drain** | **Stands.** Directly discriminates symptom patterns 1 and 2 (§0.5), and costs nothing. |
| **90 s TS capture, PCR parsed offline** | **Done** — that is the media clock (C.0). Run against five feeds; all keep real time (C.1). Needs re-running *during* a confirmed incident. |
| **Re-verify the HLS 403 claim** | **Done** — confirmed unchanged (C.3). |
| **Poll `activeConnections` during a drain** | **Dead** — see above. |

### What this leaves

Nothing large is justified by current evidence. The honest position:

1. **Two small, safe fixes** with clear evidence and no dependence on any
   falsified premise: the language filter, and `FHD` quality parsing. Both are in
   `lib/xtream-channel-map.js`, which is stream-locked, so both need the approval
   path — but neither changes playback behaviour, only which candidate ranks
   where, and `alternates` is read by nobody today.
2. **One defect worth removing on its own merits**: the Lab's HLS excursion.
3. **Everything else waits for ground truth** — a drain, confirmed by the owner as
   it happens, with the `video.buffered` reading taken during it.

**The pattern worth noticing:** every large recommendation this document produced
— capacity, fan-out, recovery rewrites — traced back to a single untested number
in §1. The small fixes, which came from reading code and checking it against the
live catalogue, all survived.
