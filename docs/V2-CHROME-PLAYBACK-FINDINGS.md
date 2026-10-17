# V2 (Mist) playback on Chrome — findings (Oct 17, 2026)

Status: **not confirmed 100%.** Server-side causes are confirmed from Railway logs and live
stream captures. The Chrome-specific mechanism is inferred from the player code and has not been
reproduced in a real Chrome. (Playwright's Chromium has no H.264 decoder, so it can't
reproduce this.) Section 4 says how to confirm it.

Pair with `docs/HANDOFF-V2-SECOND-ACCOUNT.md`. Everything here also applies to slot B.

## 1. Confirmed: the provider feed is bursty

- `/api/active` on `v2-control` for `iptv-3653` (beIN 3) reported Mist health
  `"issues":"High jitter (6043ms)!"`. Tracks: H.264 Main 1024x576 25fps with B-frames + AAC-LC 48k,
  which Chrome supports. The codec is not the problem.
- `v2-iptv-relay` logs: the provider serves this channel as **HLS with 6 s segments**
  (`targetDuration: 6`, 5-segment window). The relay (`transport-mode: hls-to-ts`) downloads each
  ~0.8–1.2 MB segment in ~1.2–1.4 s and forwards it to Mist as one burst, about every 6 s.
- Mist re-cuts into 2 s HLS segments (`TARGETDURATION:3`, 24-segment window). Polling the Mist media
  playlist showed it **unchanged for >4 s and then +3 segments at once**. That is the 6 s burst
  passing through.
- Six consecutive Mist segments were clean: each starts on a keyframe, PTS is continuous across
  segments, and A/V start offset is ~0.1 s. Between restarts the output is well-formed.

## 2. Confirmed: one bad provider segment restarts Mist's input

`v2-iptv-relay`, Oct 16 15:41–16:14 UTC (match time), streamId 3653. About **10 stream
restarts in 33 minutes**, each `stream-body-error` with one of:
`Provider HLS segment failed with HTTP 404` (segment already rotated out of the provider's
30 s window), `HTTP 522` (provider CDN origin timeout), `fetch failed`, `terminated`.
Mist's controller logs show the matching `INPUT:TS` sessions ending after 25–562 s, some at
5–53 KB/s instead of the normal ~157 KB/s.

Cause in code (KoraZero-StreamV2 `server/provider-hls-source.js`): a non-OK segment response
**throws** (`Provider HLS segment failed with HTTP …`). There is no retry and no skip-ahead.
The relay's TS body ends, so Mist's input ends and reconnects. Every reconnect is a timeline
break for every viewer.

This hits all browsers. What differs is how each player survives it (section 3).

## 3. Inferred: why Chrome suffers more than iPhone/Safari

On Chrome, V2 plays through `mountPlanSource` → `mountPinnedMainMirror` in `assets/js/watch.js`
(**locked**). Unless Chrome reports native HLS support, it uses hls.js 1.5.13:

```js
activeHls = new window.Hls({ enableWorker: false });   // all defaults
activeHls.on(window.Hls.Events.ERROR, (_e, data) => { if (data && data.fatal) onError(); });
```

1. **Live edge too close for a 6 s burst source.** The default `liveSyncDurationCount: 3` puts
   the player 3 × 2 s = 6 s behind the edge, which is exactly the burst interval. The buffer runs
   close to empty before every burst, so any slow provider fetch becomes a stall
   (`bufferStalledError`, nudges, visible freezes). Safari's native player holds back further
   and rides it out.
2. **No recovery.** Any fatal hls.js error (playlist load failure while Mist restarts its
   input, media error after a timestamp jump) runs `onError`. That replaces the video with
   `watch.manualMirrorFailed` and does nothing else: no `startLoad()`, no `recoverMediaError()`.
3. **The 20 s refresh can restart a stalled player.** `v2PinnedMirrorAlreadyHealthy` needs
   `video.readyState >= 2`. If the 20 s plan refresh lands mid-stall (readyState often 1), the
   player is destroyed and rebuilt from scratch. The same refresh is also the only thing that
   gets past the error screen in point 2, so viewers see error → blank → restart cycles.
4. **Unverified:** if a current Chrome build answers
   `video.canPlayType("application/vnd.apple.mpegurl")` with a non-empty string, Chrome takes the
   **native** branch (`video.src = src`, one `error` listener, no recovery at all). Check
   that before assuming hls.js is in play.

## 4. How to confirm (cheap, safe)

Opening a V2 page adds a **Mist viewer**, not a provider connection, so this is safe while
others watch. Do not use the remote's switch/off buttons for testing.

- In the affected Chrome, open the match page, DevTools console:
  `document.createElement('video').canPlayType('application/vnd.apple.mpegurl')`
  (empty string → hls.js path; `maybe`/`probably` → native path).
- With hls.js: `Hls.version`. Then watch the console and Network panel during a freeze for hls.js
  error `type/details/fatal`, and whether `index.m3u8` requests 404 or stall.
- During a match, correlate freezes with relay `stream-body-error` lines (Railway project
  "KoraZero Stream V2", service `v2-iptv-relay`) and Mist `INPUT:TS … ended` lines (`v2-mist`).
- To see what Mist emits across an input restart (whether there is an `#EXT-X-DISCONTINUITY`, a
  PTS jump, or a playlist 404), poll
  `https://v2-mist-production.up.railway.app/hls/iptv-<id>/index.m3u8` → variant playlist every 2 s
  and `ffprobe` the segments around a restart.

## 5. Fixes, in order of value

**A. Relay resilience** (KoraZero-StreamV2, not locked; affects every browser):
`server/provider-hls-source.js`: on a segment 404, refetch the playlist and jump to the
newest segment instead of throwing. On 5xx / `fetch failed` / `terminated`, retry with
backoff for up to ~2 × targetDuration before giving up. Keep the TS body open meanwhile; the
relay's null-burst keepalive in `iptv-relay-core.js` already exists for this. Tests in
`tests/iptv-relay.test.js`: a 404 mid-stream does not end the body; a 522 then 200 does not end
the body; 3 consecutive failures past the budget do end it. (The second-account handoff lists
this file as do-not-touch **for that work**. This is a separate, focused fix.)

**B. Chrome player config** (MorshLive `assets/js/watch.js`, **locked**: needs the
`config/stream-change-plan.json` + `KZ_STREAM_CHANGE_APPROVED` flow in `docs/STREAM-LOCK.md`,
re-baseline only `watch.js`). V2 mount only (`V2_MIST_HLS_RE` matches):
- hls.js config `{ enableWorker: true, liveSyncDuration: 12, liveMaxLatencyDuration: 30, maxBufferHole: 1 }`
  (12 s = two provider bursts; costs ~6 s extra latency);
- on fatal `NETWORK_ERROR` → `hls.startLoad()` (bounded, e.g. 3 tries in 30 s); on fatal
  `MEDIA_ERROR` → `recoverMediaError()`, then `swapAudioCodec()` + `recoverMediaError()`; only then
  `onError`;
- in `v2PinnedMirrorAlreadyHealthy`, treat the same URL with a live hls instance and no fatal
  error as healthy for up to ~15 s of `readyState < 2`, so the 20 s refresh never restarts a
  player that is only stalling;
- log hls.js `ERROR` events as `[KZ-V2] type/details/fatal` to the console, so the next report
  has evidence.

**C. Optional:** smooth the relay's output (pace each 6 s provider segment over ~6 s instead
of a 1.2 s burst) to reduce Mist jitter. Only consider it after A and B are measured.

`tests/v2-path-isolation.test.js` and `tests/psg-v2-matchday-stability.test.js` pin parts of
this mount path. Keep them green, and extend them for the new recovery behaviour rather than
loosening them.
