/**
 * The one MPEG-TS live config. Canonical definition — `assets/js/mpegts-config.js`
 * mirrors it for the browser and `tests/mpegts-config.test.js` fails if the two
 * ever drift.
 *
 * Measured against the production Xtream proxy in real Chrome 152: a steady
 * ~500 KB/s feed, a 12-28s buffer and zero dropped frames over 40s. Every value
 * here is load-bearing:
 *
 * - `enableStashBuffer: false` + a tiny `stashInitialSize` keep live latency
 *   down. mpegts.js warns this "may stall if there's network jittering", but the
 *   stream reaches us over one long-lived proxied connection rather than the
 *   open internet, and the stashing variant (384KB) is what shipped during the
 *   blacked-out iOS build.
 * - `enableWorker: false` — transmuxing in a worker is still marked unstable
 *   upstream, and the main-thread path is the one that has been measured good.
 * - `enableWorkerForMSE` stays off. It needs MediaSource-in-Workers, which only
 *   Chrome and Safari 18+ have; turning it on unconditionally is what blacked
 *   out iOS.
 * - `liveSync` stays off. Upstream issue #276 reports live streams freezing
 *   within minutes when it is on, which is exactly what watch-xtream.js was
 *   doing before this module existed.
 */
export const LIVE_TS_CONFIG = Object.freeze({
  enableWorker: false,
  enableWorkerForMSE: false,
  enableStashBuffer: false,
  stashInitialSize: 128,
  liveSync: false,
  liveBufferLatencyChasing: false,
});

/** The mpegts.js build every page must load. Kept here so HTML tags can be linted. */
export const MPEGTS_VERSION = "1.8.1";
