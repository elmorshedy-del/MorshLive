# Handoff — fix V2 (Mist) playback on Chrome

Read first: `docs/V2-CHROME-PLAYBACK-FINDINGS.md` (the evidence), then `AGENTS.md`,
`docs/STREAM-LOCK.md`. Scope is **V2 / Mist only**
(`https://v2-mist-production.up.railway.app/hls/iptv-<id>/index.m3u8`). Not the IPTV Lab / Xtream line.

Two independent fixes, shipped in this order:

| Part | Repo | Locked? | Who benefits |
|------|------|---------|--------------|
| **A. Relay rides through provider hiccups** | `elmorshedy-del/KoraZero-StreamV2`, branch off `feature/gateway-control` | No | Every browser: removes most Mist input restarts |
| **B. Chrome player tolerates bursts and recovers** | `elmorshedy-del/MorshLive` (this repo), branch `cursor/<name>-f540` | **Yes**: `assets/js/watch.js`, `watch.html` | Chrome / Android / Edge / Firefox (hls.js path) |

Ship A, measure one match window, then ship B. Either one alone is an improvement. Don't
bundle them in one deploy, or you can't tell which one helped.

---

## Part A — relay: one bad provider segment must not end the stream

### Problem (confirmed)

`server/provider-hls-source.js` → `nextSegmentBytes()` throws on any non-OK segment
(`Provider HLS segment failed with HTTP 404/522`). `fetchPlaylist()` throws on any non-OK
playlist, and a network error (`fetch failed`, `terminated`) bubbles out too. Any of these ends
the relay's TS body. Mist then ends its `INPUT:TS` session and reconnects, and every viewer gets a
timeline break. Oct 16 15:41–16:14 UTC: ~10 restarts in 33 min on `iptv-3653`.

### Change (files)

| File | Change |
|------|--------|
| `server/provider-hls-source.js` | Add bounded recovery (spec below). New options: `maxGapMs` (default `Math.max(12_000, 3 × targetDuration × 1000)`), `nowFn = Date.now`, `onRecovery = () => {}`. Keep `sleepFn` injectable. |
| `server/iptv-relay-core.js` | **Only** at the `createProviderHlsTsStream({...})` call (~line 556): pass `onRecovery` that logs `{"event":"provider-hls-recovery","streamId","kind","status","attempt","gapMs"}` and increments new per-stream stats counters `hlsSegmentRetries`, `hlsSegmentSkips`, `hlsPlaylistRetries`, `hlsCatchUps` (add them in `createStreamStats()` and the global stats object next to `keepaliveBursts`). Nothing else in this file. |
| `tests/provider-hls-source.test.js` (new) | Unit tests, listed below. |
| `tests/iptv-relay.test.js` | One integration test (below). Existing tests stay unmodified. |

### Recovery spec for `nextSegmentBytes()` / `refreshMediaPlaylist()`

One "gap episode" starts at the first failure and ends at the next successfully delivered
segment. Within an episode:

1. **Abort first:** if `signal.aborted`, or the error's `name === 'AbortError'`, rethrow
   immediately. Never retry a cancelled pull. That would break "release a stale provider pull
   when the downstream request aborts".
2. **Segment 404 / 410** (gone from the provider window): call `onRecovery({kind:'segment-skip', status})`
   and drop this URL. Refresh the playlist (with retry, rule 4) and continue with what's pending.
3. **Segment 5xx / 429 / network error** (`TypeError`, including `fetch failed` and `terminated` while
   reading `arrayBuffer()`) **/ non-TS body:** call `onRecovery({kind:'segment-retry', status, attempt})`,
   wait `min(500 × 2^(attempt-1), 4000)` ms via `sleepFn`, and retry **the same URL**. If a retry
   returns 404/410, apply rule 2.
4. **Playlist failure** (non-OK, network error, unparsable): call
   `onRecovery({kind:'playlist-retry', status, attempt})`, use the same backoff, and retry the same
   `mediaUrl`.
5. **Catch-up:** after any refresh during an episode, if more than 3 unseen segments are
   pending, keep only the newest 2 and call `onRecovery({kind:'catch-up', dropped})`. The relay
   must rejoin live, not replay a backlog to Mist.
6. **Budget:** once `nowFn() - episodeStart > maxGapMs`, throw the **original** error message,
   exactly as today. Mist then reconnects as before. This keeps the existing fail-safe.
7. **One request at a time.** Retries are sequential, with never two provider fetches in
   flight for one stream. Don't add parallel prefetch: the account is `max_connections: 1`.

While the source is retrying, the relay's existing null-burst keepalive
(`iptv-relay-core.js`, `idleKeepaliveMs`) keeps Mist's input alive. That's why Mist sees a
short silence instead of an ended input. Don't change the keepalive.

### Part A: do not touch

`iptv-relay-core.js` TS framer, null-burst construction, PAT/program parsing, audio-delay
code, allowlist, one-pull lock, catalog/account endpoints. Also `server/gateway-service.js`,
`server/control-server.js`, `server/mist-api.js`, `server/source-supervisor.js` (and the
`if (false) app.sourceSupervisor.start()` line), `V2_EMERGENCY_3645_ONLY` handling, `src/**`.
No Mist config changes. This work also doesn't touch anything in the second-account handoff.

### Part A tests (`npm test` = `node --test`; also `npm run audit:donor`)

`tests/provider-hls-source.test.js`, with a scripted fake `fetchFn`, fake `sleepFn` and fake `nowFn`:

1. Segment 404 → skipped; the next segment's bytes are delivered; the stream does not error;
   `onRecovery` sees `segment-skip`.
2. Segment 522, then 200 for the same URL → bytes delivered exactly once, in order.
3. `fetchFn` rejects `TypeError('fetch failed')` twice, then OK → continues; backoff calls
   are 500, then 1000.
4. `arrayBuffer()` rejects `TypeError('terminated')` → treated like rule 3.
5. Playlist refresh 503, then OK → continues; `playlist-retry` emitted.
6. Failures persist past `maxGapMs` → the stream errors with the original message (fail-safe).
7. Signal aborted during a backoff sleep → `AbortError`; no further `fetchFn` calls.
8. Refresh shows 6 unseen segments mid-episode → only the newest 2 are fetched; `catch-up`
   reports `dropped: 4`.
9. The fake `fetchFn` counts in-flight requests: the maximum is never above 1.
10. A clean run (no failures) produces the identical fetch sequence to today, with no
    `onRecovery` calls.

`tests/iptv-relay.test.js`: add "HLS-backed relay keeps the Mist body open across a provider
segment 404". The downstream receives segment 1 bytes, then null bursts, then segment 3 bytes,
and the body never closes. All existing tests pass unmodified, in particular
"releases a stale provider pull when the downstream request aborts", "relay normalizes an
HLS-backed provider stream into MPEG-TS for Mist", and the one-pull tests.

### Part A: deploy and acceptance

Deploy `v2-iptv-relay` from the merged branch. **Acceptance after the next match window**
on a V2 channel, from Railway logs (project "KoraZero Stream V2"):
- `v2-mist`: count of `INPUT:TS … ended` lines during the match. Baseline is ~10 per 33 min
  (Oct 16 15:41–16:14 UTC). Target: a large drop.
- `v2-iptv-relay`: `provider-hls-recovery` events appear where `stream-body-error` used to.

Rollback: Railway → `v2-iptv-relay` → redeploy the previous deployment.

---

## Part B — Chrome player: survive 6 s bursts and recover from errors

### Problem (code facts in `assets/js/watch.js`)

V2 mounts via `mountPlanSource()` → `mountPinnedMainMirror(href, fallbackUrl, false)`:

- If `video.canPlayType("application/vnd.apple.mpegurl")` is truthy, it uses native HLS with
  one `error` listener. That's right for Safari/iOS, and unverified for current Chrome.
- Otherwise it uses `new window.Hls({ enableWorker: false })` with **default** live settings
  (`liveSyncDurationCount: 3` → 6 s behind live, the same as the provider's 6 s burst interval).
  Any `fatal` error calls `onError()`, which shows `watch.manualMirrorFailed` and **does
  nothing else**.
- The 20 s `fetchAndApplyPlan().then(loadPlayer)` interval remounts unless
  `v2PinnedMirrorAlreadyHealthy(url)`, which requires `video.readyState >= 2`. A refresh landing
  mid-stall restarts the player from scratch.

### Change (files)

| File | Change |
|------|--------|
| `assets/js/v2-hls-policy.js` (**new**) | Pure policy, no DOM: `KZ_V2_HLS_CONFIG` + `KZV2Recovery`. Use the dual export pattern of `assets/js/team-names.js` (sets a global in the browser, `module.exports` under Node) so Vitest can `require` it. |
| `assets/js/watch.js` (**locked**) | Use the policy **for V2 URLs only** inside `mountPinnedMainMirror` and `v2PinnedMirrorAlreadyHealthy`. |
| `watch.html` (**locked**) | Add `<script src="assets/js/v2-hls-policy.js?v=<stamp>"></script>` **before** `watch.js`; bump `watch.js?v=`. |
| `scripts/verify-stream-lock.mjs` | Re-baseline `assets/js/watch.js` and `watch.html`, and **add** `assets/js/v2-hls-policy.js` to `LOCKED_FILES`, under one stamp `CLAUDE-STAMP <date> — V2-CHROME-HLS-1`. |
| `.github/CODEOWNERS` | Add `/assets/js/v2-hls-policy.js @elmorshedy-del` next to the other stream files. (This is CODEOWNERS, not a workflow.) |
| `config/stream-change-plan.json` | Temporary: `allowedFiles: ["assets/js/watch.js","watch.html"]`, 24h expiry, then delete. |
| `tests/v2-hls-policy.test.js`, `tests/v2-chrome-playback.test.js` (new) | Below. |

### `assets/js/v2-hls-policy.js` — exact contents to implement

**Config** (hls.js 1.5.13 option names; do **not** mix with `liveSyncDurationCount`, because hls.js throws):

```js
KZ_V2_HLS_CONFIG = Object.freeze({
  enableWorker: true,
  liveSyncDuration: 14,        // >= 2 provider bursts (6 s) + margin
  liveMaxLatencyDuration: 36,  // must be > liveSyncDuration; Mist window is ~48 s
  maxLiveSyncPlaybackRate: 1,  // no speed-up wobble
  maxBufferHole: 1.5,          // same as lib/hls-recover.js operatorMaxBufferHole()
  initialLiveManifestSize: 3,  // don't start on a single live-edge fragment
});
```

**Recovery**: `KZV2Recovery.create({ now })` returns a tracker with
`decide({ type, details, fatal })` → one action:

| Input | Action |
|-------|--------|
| `fatal: false` | `"ignore"` (hls.js handles non-fatal stalls itself) |
| fatal `networkError`, network attempts in the last 60 s < 3 | `"resume-load"` with `delayMs` 2000 / 4000 / 8000 |
| fatal `mediaError`, 1st in 60 s | `"recover-media"` |
| fatal `mediaError`, 2nd in 60 s | `"swap-audio-and-recover"` |
| budgets above exhausted, no remount in the last 60 s | `"remount"` (one fresh mount of the same URL) |
| anything after a remount in the last 60 s, or any other fatal type | `"give-up"` |

Plus `noteProgress()`: 60 s of continuous playback resets all budgets.
`now` is injected (tests), defaulting to `Date.now`.

### `watch.js` changes — exact behaviour (V2 URLs only: `V2_MIST_HLS_RE.test(url)`)

1. **Engine choice:** for V2, use hls.js when
   `window.Hls && window.Hls.isSupported() && !String(navigator.vendor || "").startsWith("Apple")`.
   Otherwise keep the existing native branch. Apple vendor covers Safari macOS, every iOS browser
   (iOS Chrome is WebKit) and iPadOS, which currently work and must stay on native HLS. This makes
   Chrome deterministic even if it ever reports native HLS support.
2. **Config:** `new window.Hls(window.KZ_V2_HLS_CONFIG)`; keep `forceHighestHlsLevel(activeHls)`.
3. **Errors:** route every `Hls.Events.ERROR` through one tracker per mount:
   - `resume-load` → after `delayMs`, `activeHls.startLoad(pos)`, where `pos` = `video.currentTime`
     if it lies inside `video.seekable`, else `-1`. **Never** a bare `startLoad()` on `waiting`
     (see `lib/hls-recover.js`: that snaps to the live edge and loops).
   - `recover-media` → `activeHls.recoverMediaError()`.
   - `swap-audio-and-recover` → `activeHls.swapAudioCodec(); activeHls.recoverMediaError();`.
   - `remount` → `mountPinnedMainMirror(url, fallbackUrl, false)` after `destroyInlineHls()`. Keep a
     per-URL "remounted at" timestamp so it happens once per 60 s.
   - `give-up` → the existing `onError()` (same-content `fallbackUrl`, else the
     `manualMirrorFailed` card). Unchanged.
   - Log each decision once: `console.warn("[KZ-V2]", data.type, data.details, data.fatal, action)`.
4. **Progress:** `video.addEventListener("timeupdate", …)` → `tracker.noteProgress()` and
   `v2LastProgressAt = Date.now()`.
5. **Health guard:** in `v2PinnedMirrorAlreadyHealthy(url)`, after the existing URL checks
   (which must stay byte-for-byte: `const currentUrl = String(loadedUrl || "").replace…` and
   `if (currentUrl !== href) return false;`), also return `true` when
   `activeHls && video && !video.error && Date.now() - v2LastProgressAt < 20000`,
   even if `readyState < 2`. A briefly stalling player is not restarted by the 20 s refresh.
6. **Non-V2 URLs** (manual mirrors, other `kind: "hls"` plans) keep exactly
   `new window.Hls({ enableWorker: false })` and today's fatal → `onError` behaviour. No change.

### Part B: do not touch

The muted autoplay markup (pinned by `tests/psg-v2-matchday-stability.test.js`);
`mountInlineHls`, the Lab/Xtream/mpegts paths (`mountLabChannel`, `fetchLabChannel`,
`watch-xtream.js`, `mpegts-config.js`, `watch-lab-continuity-guard.js`, `iptv-*`);
`V2_MIST_HLS_RE`; `mountPlanSource` routing; the 20 s / 90 s intervals; the hls.js version in
`watch.html` (1.5.13: an upgrade is a separate, owner-approved change);
`backend/**`, `worker.js`, `wrangler.toml`, `lib/hls-recover.js`.

### Part B tests (`npm run lint && npm test`)

`tests/v2-hls-policy.test.js` (pure, `require("../assets/js/v2-hls-policy.js")`):
1. Config: `liveSyncDuration >= 12`; `liveMaxLatencyDuration > liveSyncDuration`;
   no `liveSyncDurationCount` / `liveMaxLatencyDurationCount` keys; frozen.
2. Non-fatal → `ignore`.
3. Network fatal ×3 → `resume-load` with 2000/4000/8000; 4th → `remount`; next → `give-up`.
4. Media fatal → `recover-media`, then `swap-audio-and-recover`, then `remount`.
5. Unknown fatal type → `remount` once, then `give-up`.
6. `noteProgress()` with 60 s elapsed resets the budgets (a new network fatal → `resume-load` 2000).
7. 61 s after a remount, a new fatal is allowed another remount.

`tests/v2-chrome-playback.test.js` (source checks on `watch.js` / `watch.html`, the same style as
`psg-v2-matchday-stability.test.js`):
1. `watch.html` loads `v2-hls-policy.js` before `watch.js`.
2. Inside `function mountPinnedMainMirror`, the V2 branch uses `KZ_V2_HLS_CONFIG` and `KZV2Recovery`
   and checks `navigator.vendor` before choosing native.
3. The non-V2 path still contains `new window.Hls({ enableWorker: false })`.
4. The `mountPinnedMainMirror` block never calls `startLoad()` with no argument.
5. `v2PinnedMirrorAlreadyHealthy` contains the progress-based clause **after**
   `if (currentUrl !== href) return false;`.

These must stay green **unmodified**: `psg-v2-matchday-stability.test.js`,
`v2-path-isolation.test.js`, `v2-single-socket.test.js`, `hls-recover.test.js`,
`mpegts-config.test.js`, and `stream-lock.test.js` after the re-baseline (its pinned
hashes for `iptv-lab.js`, `watch-lab-continuity-guard.js`, `mpegts-config.js` and `worker.js` don't move).

### Part B: verification (real Chrome; Playwright's Chromium can't decode H.264)

Safe while others watch: opening a V2 page adds a Mist viewer, not a provider connection.
Never use the remote's switch/off for testing.

1. Chrome desktop, V2 match page, DevTools console: confirm hls.js is in use
   (`Hls.version` → `1.5.13`, video `src` is a `blob:`), and that no `[KZ-V2]` lines appear while
   it plays normally.
2. DevTools → Network → **Offline** for 10 s, then back online. Expect `[KZ-V2] networkError … resume-load`;
   the picture resumes without the "couldn't play" card and without a page reload.
3. Offline for 90 s. Expect resume attempts, then one `remount`, then (if still offline) the card;
   back online, the next 20 s refresh brings it back.
4. Leave it playing through a full match half. No error card; at most short freezes at
   provider hiccups (fewer once Part A is live).
5. iPhone Safari and iOS Chrome: unchanged behaviour (native HLS, no `[KZ-V2]` lines).

After merge: bump `?v=`, curl live `watch.html` for the new `?v=` per `AGENTS.md` → Production
freshness, and force `npm run deploy` (with the approval variable) if needed.

Rollback: revert the commit and re-baseline the lock to the previous hashes using the same plan
flow. Part A is unaffected.

---

## Guardrails (both parts)

- No tree-wide rollback. No change to any locked file except `watch.js` and `watch.html`, plus the
  new policy file joining the lock.
- No new automated media probes and no CI live-stream checks. Keep
  `.github/workflows/premium-iptv-smoke.yml` as it is.
- Don't touch the IPTV Lab / `IPTV_LAB_JSON` / `XTREAM_PORTALS_JSON` path.
- No credentials in code, logs or `onRecovery` events (status codes and counters only, never URLs:
  provider playlist and segment URLs can carry the account username, password or tokens).
- Don't weaken or delete existing tests to get green.
- Don't upgrade hls.js or add npm dependencies as part of this work.
