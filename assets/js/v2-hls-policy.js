(function (global) {
  "use strict";

  const WINDOW_MS = 60_000;
  const PROGRESS_GAP_MS = 5_000;
  const NETWORK_DELAYS_MS = [2_000, 4_000, 8_000];

  const KZ_V2_HLS_CONFIG = Object.freeze({
    enableWorker: true,
    liveSyncDuration: 14,
    liveMaxLatencyDuration: 36,
    maxLiveSyncPlaybackRate: 1,
    maxBufferHole: 1.5,
    initialLiveManifestSize: 3,
  });

  function create({ now = Date.now } = {}) {
    if (typeof now !== "function") throw new Error("KZV2Recovery requires a clock");

    let networkAttempts = [];
    let mediaAttempts = [];
    let remountedAt = null;
    let progressStartedAt = null;
    let lastProgressAt = null;

    function prune(current) {
      networkAttempts = networkAttempts.filter((at) => current - at < WINDOW_MS);
      mediaAttempts = mediaAttempts.filter((at) => current - at < WINDOW_MS);
      if (remountedAt !== null && current - remountedAt >= WINDOW_MS) remountedAt = null;
    }

    function resetBudgets() {
      networkAttempts = [];
      mediaAttempts = [];
      remountedAt = null;
    }

    function remountOrGiveUp(current) {
      if (remountedAt !== null && current - remountedAt < WINDOW_MS) {
        return { action: "give-up" };
      }
      remountedAt = current;
      return { action: "remount" };
    }

    function decide({ type = "", fatal = false } = {}) {
      if (!fatal) return { action: "ignore" };

      const current = Number(now());
      if (!Number.isFinite(current)) throw new Error("KZV2Recovery clock must return milliseconds");
      prune(current);

      if (type === "networkError") {
        if (networkAttempts.length < NETWORK_DELAYS_MS.length) {
          const delayMs = NETWORK_DELAYS_MS[networkAttempts.length];
          networkAttempts.push(current);
          return { action: "resume-load", delayMs };
        }
        return remountOrGiveUp(current);
      }

      if (type === "mediaError") {
        if (mediaAttempts.length === 0) {
          mediaAttempts.push(current);
          return { action: "recover-media" };
        }
        if (mediaAttempts.length === 1) {
          mediaAttempts.push(current);
          return { action: "swap-audio-and-recover" };
        }
        return remountOrGiveUp(current);
      }

      return remountOrGiveUp(current);
    }

    function noteProgress() {
      const current = Number(now());
      if (!Number.isFinite(current)) throw new Error("KZV2Recovery clock must return milliseconds");

      if (
        lastProgressAt === null ||
        current < lastProgressAt ||
        current - lastProgressAt > PROGRESS_GAP_MS
      ) {
        progressStartedAt = current;
      }

      lastProgressAt = current;
      if (progressStartedAt !== null && current - progressStartedAt >= WINDOW_MS) {
        resetBudgets();
        progressStartedAt = current;
      }
    }

    return Object.freeze({
      decide,
      noteProgress,
    });
  }

  const KZV2Recovery = Object.freeze({ create });

  global.KZ_V2_HLS_CONFIG = KZ_V2_HLS_CONFIG;
  global.KZV2Recovery = KZV2Recovery;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { KZ_V2_HLS_CONFIG, KZV2Recovery };
  }
})(typeof window !== "undefined" ? window : globalThis);
