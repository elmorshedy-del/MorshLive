/**
 * Browser mirror of lib/mpegts-config.js. Load this before any player script.
 * tests/mpegts-config.test.js fails if these values drift from the canonical
 * module, so change both or neither.
 */
(() => {
  "use strict";
  window.KZ_LIVE_TS_CONFIG = Object.freeze({
    enableWorker: false,
    enableWorkerForMSE: false,
    enableStashBuffer: false,
    stashInitialSize: 128,
    liveSync: false,
    liveBufferLatencyChasing: false,
  });
})();
