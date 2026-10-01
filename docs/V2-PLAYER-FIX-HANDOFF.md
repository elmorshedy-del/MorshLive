# V2 playback — what to fix, and how to test it

Handoff written 2026-10-01 from the Sep 27 traffic investigation. Self-contained:
everything needed to implement and verify is here. Line numbers are against
`main` at the time of writing — re-check them before editing.

---

## 0. Background in five lines

- **V2** = MistServer on Railway (`v2-mist-production.up.railway.app/hls/iptv-<id>/index.m3u8`).
  One provider connection into Mist, fanned out to any number of viewers.
- The Worker (`backend/services/stream-plan.js`) only hands a viewer the Mist URL if
  the match's channel equals the channel `v2-control` reports at `/api/active`.
  Otherwise the plan is `waiting` and the page shows **"جاري تجهيز البث"** with no player.
- Only **one** Mist channel can be live at a time (the provider line allows one connection,
  and a second connection evicts the first).
- Mist itself performed well on Sep 27 once a channel was producing: ~14,800 requests, ~87 client
  errors (mostly before Al Kass 2 came up at 15:30), segments in 10–50 ms. **Capacity is not the problem.** The problems are in the page and in channel routing.
- Fixes are listed in priority order. Fix 1 is the one actively breaking Android viewers today.

---

## 1. Ground rules

1. **`assets/js/watch.js` is stream-locked** (`scripts/verify-stream-lock.mjs`, baseline `8fe04a34`).
   Changing it requires BOTH:
   - `config/stream-change-plan.json` with `reason` (≥ 20 chars), `baseline` (the full baseline
     commit hash from the script), `expiresAt` (≤ 24 h ahead), `allowedFiles` (exactly the files changed);
   - `KZ_STREAM_CHANGE_APPROVED=YES_I_INTEND_TO_CHANGE_PRODUCTION_STREAMING` in the deploy environment.
   After it is verified in production, re-establish the baseline and remove the approval.
2. **Never open a raw provider stream to test.** The provider line evicts the viewer already
   watching when a new connection opens. Test players against Mist only.
3. **Only ever request the channel `/api/active` reports.** Requesting another channel from Mist
   makes Mist pull it from the provider, which evicts the live channel for every viewer.
4. **Don't redeploy `v2-control` during a match** (see Fix 3).
5. `npm run lint && npm test` before merging.
6. Existing source-contract tests pin this code and must keep passing:
   `tests/psg-v2-matchday-stability.test.js` (same-URL guard exists and runs **before**
   `destroyInlineHls`) and `tests/v2-path-isolation.test.js`. They pin the structure,
   not the `readyState` check — the fix below keeps the structure.

---

## 2. Fixes

### Fix 1 (P0) — Stop the V2 player restarting itself every 20 seconds

**Symptom.** Android viewers' players restart repeatedly. On Sep 27 one Android Chrome viewer
restarted 12 times in 35 minutes; another (Facebook in-app, Android) 4 times in 4 minutes.
iPhones (including Chrome on iPhone, which uses Safari's engine) held cleanly.

**Evidence (Mist request log, Android Chrome, Sep 27 20:16:55–20:18:03 UTC).** Every request
returned 200 in 10–48 ms and segments arrived continuously, yet the player re-fetched the master
playlist — a full restart — at 20:16:55.5, 20:17:04.6, **20:17:04.9**, **20:17:24.8**, **20:17:44.8**,
20:17:53.5. Three are exactly 20 s apart. After 20:17:04 every segment was downloaded **twice**,
~0.3 s apart, for ~7 s: two players were running at once.

**Root cause — three parts, all in `assets/js/watch.js`:**

1. **A timer re-mounts the player unconditionally.** `setInterval(() => fetchAndApplyPlan().then(() => loadPlayer()), 20 * 1000)`
   (~line 2224). The only thing stopping a teardown is `v2PinnedMirrorAlreadyHealthy()` (~line 975):
   ```js
   return !!(video && video.readyState >= 2 && !video.error && !video.ended);
   ```
   This tests the video **at one instant**. If at the tick the player is starting up, rebuffering for
   a moment, or reports itself not ready for any other reason, it is destroyed and rebuilt from zero.
   If startup takes longer than 20 s, it can never finish.
2. **Two triggers can remount within the same second.** `refreshMatches()` (90 s timer, ~line 2223)
   also calls `loadPlayer()` (~line 2183). The second call sees the freshly created video at
   `readyState 0`, fails the guard, and remounts again — the 20:17:04.6 / 20:17:04.9 pair.
3. **The old player isn't stopped.** `destroyInlineHls()` (~line 329) only destroys hls.js and
   mpegts.js instances. `mountPinnedMainMirror()` (~line 1009) checks **native HLS first**
   (`video.canPlayType("application/vnd.apple.mpegurl")`), and Android Chrome answers yes. On that
   path the old `<video>` is only removed via `shell.innerHTML = …` — never paused or unloaded —
   so it keeps downloading. On mobile data that doubles bandwidth, which causes stalls, which
   fail the guard again.

**Changes:**

- **1a. Make the V2 health check progress-based, not instant.** Keep the same-URL check exactly as
  it is. Replace the instant `readyState` test with: track `mountedAt`, and `lastProgressAt` from the
  video's `timeupdate` / `playing` events (whenever `currentTime` advances). For a same-URL V2 player,
  **do not remount** unless one of these holds:
  - an `error` event fired on the video, or hls.js raised a fatal error that recovery didn't fix;
  - the video is not user-paused, and `now − max(lastProgressAt, mountedAt) > 15 s`
    (with a 30 s grace period after `mountedAt` for startup).
  Put the decision in a pure function (e.g. `shouldRemountV2(state)`) so it can be unit-tested.
- **1b. Fully stop a native player before replacing it:** `video.pause(); video.removeAttribute("src"); video.load();`
  Do this for the existing `.kz-main-video` inside `destroyInlineHls()` or a helper that
  `mountPinnedMainMirror()` calls before rewriting `shell.innerHTML`.
- **1c. Make `loadPlayer()` single-flight.** If a load is already running, return the same promise
  instead of starting another. Additionally ignore a remount for the same V2 URL within ~5 s of the
  previous mount.
- **1d. Prefer hls.js except on Safari / iOS.** In `mountPinnedMainMirror()` only, check
  `window.Hls && window.Hls.isSupported()` first, and use native HLS only on Safari/iOS WebKit
  (or when hls.js is unavailable). This is the standard recommendation for Android, whose built-in
  HLS reports support but behaves differently from Safari's. Limit the change to the V2 path.

**Related, separate change:** `labChannelAlreadyHealthy()` (~line 1055) uses the same instant
`readyState` pattern for the Lab/mpegts path. It is the same class of bug; fix it the same way in
a separate change, not bundled with this one.

**Do not:**
- lengthen the 20 s interval — that only slows the loop;
- remove the guard entirely — a genuinely dead player must still be recovered.

**Done when:** tests T3–T7 below pass, and the field test T8 shows exactly one master-playlist
fetch per Android viewer per session.

---

### Fix 2 (P1) — A live match must not show "Preparing the stream" because another channel is live

**Evidence (Sep 27).**

| Match | Kickoff (UTC) | Plan pointed at | What Mist was serving | Result |
|---|---|---|---|---|
| Yemen–Qatar | 15:00 | Al Kass 1 (`iptv-89778`) until a commit at **15:38** | Al Kass 2 (`iptv-89779`) first produced at 15:30 | ~30–38 min with nothing watchable |
| Bahrain–UAE | 18:00 | Al Kass 2 (`iptv-89779`), rebound at 17:57 | **beIN Sport 1 Vega (`iptv-3645`)** for the whole match | **0 real viewers got the match**; everyone got the waiting card |

**Changes:**

- **2a. Pre-kickoff check (script + scheduled CI job).** For every plan with a V2 Mist source and
  kickoff within the next 90 minutes:
  - compare the plan's `iptv-<id>` with `GET https://v2-control-production.up.railway.app/api/active`;
  - fail loudly (CI failure / notification) on a mismatch;
  - also fail if two V2 plans overlap in time on **different** channels — only one can be live.
- **2b. Honest waiting message.** When the plan reason is `v2-remote-other:<channel>` and the match is
  in progress, don't show "Preparing the stream… no default player will load". Say plainly that this
  match isn't available right now. (Wording is a product decision; the current text implies it is
  about to start.)
- **2c. Operating procedure:** bind the match **and** set the active channel at least 30 minutes
  before kickoff. Never rebind after kickoff without checking `/api/active`.

**Done when:** T9 flags both Sep 27 cases.

---

### Fix 3 (P1) — `v2-control` going down must not take viewers down

**Evidence.** Between 23:24 and 00:10 UTC (Sep 27→28), `v2-control` was restarted about a dozen
times, including crashes at boot:
- `Error: V2_MIST_HLS_INTERNAL_BASE is required when V2_SMOKE_TEST_CHANNEL is set`
- `Error: HLS smoke failed for 3645: HTTP 200 with Mist HLS error playlist`

The Worker calls `/api/active` with a **1.5 s timeout** (`loadActiveV2State`). On failure it returns
`null` → `v2-remote-unavailable` → every V2 viewer gets the waiting card.

**Changes:**

- **3a. The boot smoke test must never exit the process.** Log the failure and report a degraded
  state; if `V2_MIST_HLS_INTERNAL_BASE` is missing, skip the smoke test with a warning.
- **3b. Worker keeps the last good answer.** Cache the last successful `/api/active` result
  (e.g. ~60 s in `caches.default` or per-isolate memory) and use it when the control call fails or
  times out, instead of returning `v2-remote-unavailable`.
- **3c.** Don't deploy `v2-control` during matches (procedure).

**Done when:** T10 passes.

---

### Fix 4 (P2, not code) — Ad landing page

Sep 27 Cloudflare Web Analytics: 187 visits, **149 from Facebook/Instagram, 147 of them landing on
`/` (the homepage)**. In the sampled request logs, 86% of ad visitors left within a minute and only
4 of 78 ever requested a stream. The homepage loaded fast (Facebook referrals: median 1.2 s, p90 2.9 s), so speed
wasn't the cause. **Point each ad at the specific watch URL of the match that is live on Mist.**

---

### Fix 5 (P2) — Analytics hygiene, so future debugging isn't misled

These mistakes were made during the investigation; avoid repeating them:

- **Cloudflare Early Hints rows are not failures.** Rows with user agent `nginx-ssl early hints` or
  `bastion early hints` are always logged as 504 and were **~97% of all 5xx** on Sep 19 and Sep 27.
  Early Hints is enabled on the zone. Always filter them out: GraphQL `userAgent_notlike: "%early hints%"`.
- **Filter `clientRequestHTTPHost: "korazero.com"`.** The Worker's own outbound calls are logged from
  one egress IP (`2a06:98c0:3600::103`) and labelled with random countries.
- **For visitors, referrers and page-load times use Cloudflare Web Analytics (RUM)**, not the
  request logs — the request logs block referrer and query on this plan.
- **In Mist logs:** user agent `node` = internal canaries/monitors (exclude). Each fetch of
  `/hls/iptv-<id>/index.m3u8` (the master playlist) = one player start; a repeat from the same
  client within a session = a restart.
- **Safari on iOS 26 reports itself as `iPhone OS 18_7`.** The owner's own T-Mobile US iPhone appears
  throughout the logs; exclude it when counting real viewers.

---

## 3. Tests and debugging

### Before fixing — confirm the cause on a real Android phone

**T1. Reproduce (field).** Android phone, Chrome, **mobile data**. Open a live V2 match, leave it
untouched 3 minutes. Then read the `v2-mist` service's HTTP logs on Railway with
`@path:/hls/iptv-<id>/index.m3u8 -@clientUa:node` for that window.
- Bug present: the phone's IP fetches the master playlist roughly every 20 s; segment paths appear twice.

**T2. Find which guard condition fails (field, remote debugging).** Connect the phone via
`chrome://inspect`, open the watch page's console and paste:
```js
(() => {
  let last = null, n = 0;
  setInterval(() => {
    const v = document.querySelector(".kz-main-video");
    const ts = new Date().toISOString().slice(11, 19);
    if (v !== last) { console.log(`[kz] ${ts} MOUNT #${++n}`); last = v; }
    if (!v) return;
    const end = v.buffered.length ? v.buffered.end(v.buffered.length - 1).toFixed(1) : "-";
    console.log(`[kz] ${ts} rs=${v.readyState} paused=${v.paused} ended=${v.ended} ` +
      `err=${v.error && v.error.code} t=${v.currentTime.toFixed(1)} buf=${end} ` +
      `native=${!!v.src && !v.src.startsWith("blob:")}`);
  }, 1000);
})();
```
Read the line just **before** each `MOUNT`: it shows which of `readyState`, `ended` or `error`
failed. `native=true` confirms the built-in-HLS path (Fix 1d); `native=false` means hls.js (blob URL).
Record the result in the PR description.

### Automated (must be added with the fix)

**T3. Unit test the decision function** (`shouldRemountV2` or equivalent):

| Case | Expected |
|---|---|
| different URL | remount |
| same URL, playing, progress 1 s ago | **keep** |
| same URL, `readyState` 1, mounted 5 s ago (startup) | **keep** |
| same URL, `readyState` 1 momentarily, progress 3 s ago (rebuffer) | **keep** |
| same URL, user-paused 5 min | **keep** |
| same URL, `error` fired | remount |
| same URL, not paused, no progress for 20 s, mounted > 30 s ago | remount |
| no video element | remount |

**T4. Teardown.** With jsdom (installed): after a remount, the previous `<video>` has no `src`
attribute and `pause()` / `load()` were called on it.

**T5. Single-flight.** With fake timers: two `loadPlayer()` calls 100 ms apart → exactly one mount.
The 20 s and 90 s timers firing in the same second → one mount.

**T6. Keep the existing contract tests passing** (`psg-v2-matchday-stability`, `v2-path-isolation`).
If one must change, change only the line that names the old `readyState` expression, and say so in
the PR.

**T7. Browser test (Playwright, branded Chrome: `channel: "chrome"`).** Load the watch page for the
match bound to the **currently active** channel (check `/api/active` first — rule 1.3). Record every
request to `v2-mist-production.up.railway.app` for 120 s. Run it twice, using `page.addInitScript`
to stub `HTMLMediaElement.prototype.canPlayType`:
- returning `"maybe"` for `application/vnd.apple.mpegurl` (forces the native path),
- returning `""` (forces hls.js).

Pass, in both runs:
- the master playlist was fetched **exactly once**;
- no segment URL was fetched twice;
- `video.currentTime` advanced by at least 100 s.

On the current code the native-path run is expected to fail; that is the regression proof.

### After deploy

**T8. Field acceptance.** During a live V2 match, on mobile data, 10 minutes each:
- Android phone, Chrome;
- Android phone, the link opened inside Facebook (in-app browser);
- one iPhone (control).

Pass: in the Mist logs each device fetches the master playlist **once** per session, no duplicate
segments, and nobody sees the player restart.

**T9. Pre-kickoff check regression (Fix 2).** Unit-test the check with fixtures:
- Sep 27 Bahrain–UAE: plan → `iptv-89779`, `/api/active` → `iptv-3645` → must flag a mismatch;
- plan channel equals the active channel → must pass;
- two V2 plans overlapping in time on different channels (Sep 27 had Gulf Cup on Al Kass while
  Mist served beIN 1) → must flag;
- `/api/active` unreachable → must flag (don't silently pass).

**T10. Control resilience (Fix 3), outside match hours.** With a test viewer playing, restart
`v2-control`. Pass: the viewer keeps playing, and `/api/stream-plan` keeps returning the Mist URL
(served from the cached active state) for the whole restart.

---

## 4. What is known vs not known

**Verified from logs and code:**
- Mist delivered every request successfully during the Android restarts. The restarts come from
  the page (Fix 1), not the server.
- The 20 s timer, the instant `readyState` guard, the second `loadPlayer` trigger, and the native
  teardown gap are all present on `main` today.
- On Sep 27, no real viewer received Bahrain–UAE (Mist was serving beIN Sport 1 Vega), and
  `v2-control` crash-restarted repeatedly late that night.

**Not yet known:**
- Exactly **which** guard condition fails on Android (`readyState` dip, startup over 20 s, or `ended`
  on a live stream). T2 answers it. Fix 1 removes the dependency on it either way.
- Only one of the two restarting Android viewers was traced request-by-request. The second
  (Facebook in-app, Android) restarted 4 times in 4 minutes but not on a clean 20 s rhythm; T8 should
  include an in-app viewer for that reason.
