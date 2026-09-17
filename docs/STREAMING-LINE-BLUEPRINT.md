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
| `enableStashBuffer` | `false` | keeps live latency down |
| `stashInitialSize` | `128` | measured good |
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

**Read M9 first.** It is the only entry confirmed by measurement, and it is the
only one that can explain a drain that also reproduces in the Lab. M1–M7 remain
plausible for the *site*, but every one of them is inferred from reading code
and none has been instrumented. Do not spend a session on M1 before checking
whether the feed the viewer is actually on delivers its bytes.

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

### M9 — The provider feed itself drops segments  ← confirmed for beIN, fixed

**[MEASURED 2026-09-17]** The first drain mechanism on this list confirmed by
measurement rather than inferred from code. It is also the only one that
explains a drain reproducing **in the Lab**, since the Lab has no `setInterval`,
no continuity guard and none of M1–M7.

Pulled with `scripts/diagnostics/run.mjs transport` — bytes only, no browser and
no decoder, so nothing in the player can be responsible. All three feeds are
beIN Sports 1, through the same path, within one hour:

| feed | measured | delivery gaps | rate |
|---|---|---|---|
| `2449` `beIN_1HD_1080p` ← the site's pick | 260 s | **12** (1 per ~22 s) | 2.53–3.3 Mbps |
| `46028` `beIN_SPORTS_1_1080FHD` | 110 s | 1 | 4.97–5.91 Mbps |
| `3177` `beIN_1_HD720` | 220 s | **0** | 4.08–5.09 Mbps |

Every one of `2449`'s gaps measured between **1985 and 2027 ms** — a 42 ms
spread across ten samples on two separate connections a quarter-hour apart.
Congestion and loss produce gaps of whatever length recovery happens to take.
A fixed duration is a dropped two-second segment at the source.

`3177` pulled back-to-back against it in the same run never gapped, which rules
out the network, the Worker, the token and the measuring client together.

**Why it hit beIN only.** `2449` and `46028` parse identically — both 1080
h264 — so `score()` returned the same number for both and `Array.sort` is
stable, leaving the provider's catalogue order to decide. The site got `2449` by
accident. No other channel happened to have a broken feed sorted first.

**Fixed** in `lib/xtream-channel-map.js` by `MEASURED_UNRELIABLE`, which demotes
one stream id. Viewers keep 1080 and roughly double the throughput. Lock
re-baselined as `BEIN-FEED-DEMOTE-1`.

**[THEORY — not proven]** That these 2 s delivery gaps are what a viewer
experiences as the drain. It fits: a live player holding ~2 s of buffer empties
exactly when delivery pauses 2 s. It is **not** closed, because the headless
Chromium in the agent environment has no H.264/AAC and cannot play a real TS
feed to confirm it (§6 Step 4). Treat the link as strong but open.

**Generalisation for the next agent.** Before blaming any code path, measure
whether the bytes arrive. `transport` does not touch the player, so a fault it
finds cannot be in the player. Run it against the site's pick *and* its
alternates — a healthy sibling feed is what turns "the stream is bad" into
"this feed is bad and that one is not".

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

## 8. Open items

| Item | State |
|---|---|
| M1 confirmation (remount period) | Snippet in §6 Step 1. Not yet run. |
| M1 fix | Designed, **not applied** — `watch.js` is locked, needs approval. |
| M3 accumulation | Predicted from code, never measured. |
| Idle watchdog (M7) | Absent since `ae812e3` was reverted. Not scheduled. |
| Reconnect cap (M6) | Uncapped after first play. Not scheduled. |
| M9 → viewer link | The 2 s delivery gap is measured; that it *is* the visible drain is inference. Needs a browser that can decode H.264. |
| `alternates` is read by nobody | `resolveXtreamChannel` computes and returns it, and **zero** client code consumes it. There is no failover today — a bad feed is simply played. |
| `alternates` contains wrong channels | **[VERIFIED]** For `bein-sports-1` the list carries `669 [FR]_BeIN_SPORTS_1_HD` and `89778 BeIN Alkass 1 HD`. The language filter sets `fr` only on `/\bfrench\b\|\bfra\b/`, neither of which matches the token `fr`, so `[FR]` reads as Arabic — Turkish gets a `tokens.includes("tr")` check that French and English never got. Alkass is a different Qatari broadcaster that passes because its name contains "bein" and a `1`. Harmless only while nothing reads the list; **fix both before building any failover on it.** |
| Other channels never health-checked | M9 was found on beIN because that is where the complaint was. No other channel's pick has been measured, and any of them could be sorted onto a bad feed the same way. |
