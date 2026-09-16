/**
 * KoraZero Diagnostics — the in-page probe.
 *
 * Injected before any site script runs. Two jobs:
 *
 *  1. Standard playback quality, in the CTA-2066 vocabulary (startup time,
 *     rebuffer count/duration/ratio, dropped frames) so numbers here mean the
 *     same thing they mean everywhere else in streaming.
 *  2. The KoraZero-specific signals a generic QoE tool would not know to look
 *     for: player remounts, repeated requests for the SAME media token (the
 *     signature of a teardown/rebuild rather than a fresh session), and churn
 *     on the player toolbar.
 *
 * Rebuffer detection keys off `video.currentTime` rather than wall-clock: a
 * stalled player and a paused tab look identical on a clock, and only one of
 * them is a fault.
 */

(() => {
  const t0 = performance.now();
  const at = () => +((performance.now() - t0) / 1000).toFixed(2);

  const state = {
    startedAt: Date.now(),
    startupMs: null, // time to first advancing frame
    samples: [], // [t, bufferedAhead, readyState, currentTime]
    rebuffers: [], // [startSec, durationSec, lowestBuffer]
    remounts: [], // [t] — a new <video> element appeared
    toolbarChurn: [], // [t] — #player-toolbar childList changed
    mediaRequests: [], // [t, tokenTail, method]
    errors: [],
    consoleErrors: [],
    resolved: null, // what the page decided to play
    finalVideo: null,
  };

  // ---- media requests: catch both fetch and the element's own loads --------
  const tokenOf = (u) => {
    const m = /\/api\/xtream\/media\/([^/?#]+)/.exec(String(u || ""));
    return m ? m[1].slice(-12) : null;
  };
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const u = String(args[0]?.url || args[0] || "");
    const tok = tokenOf(u);
    if (tok) state.mediaRequests.push([at(), tok, "fetch"]);
    if (/\/api\/iptv-lab\/channel/.test(u)) state.mediaRequests.push([at(), "channel-lookup", "meta"]);
    return origFetch.apply(this, args);
  };

  // ---- watch the player element -------------------------------------------
  let video = null;
  let lastTime = 0;
  let lastAdvance = 0;
  let inRebuffer = false;
  let rebufferStart = 0;
  let rebufferLow = 99;
  let everAdvanced = false;

  const bufferedAhead = (v) => {
    try {
      return v.buffered.length ? v.buffered.end(v.buffered.length - 1) - v.currentTime : 0;
    } catch {
      return 0;
    }
  };

  setInterval(() => {
    const v = document.querySelector("video");
    if (!v) return;
    if (v !== video) {
      video = v;
      state.remounts.push(at());
      lastTime = 0;
      lastAdvance = performance.now();
      v.addEventListener("error", () => {
        state.errors.push([at(), `media error code ${v.error?.code ?? "?"}`]);
      });
    }

    const ahead = bufferedAhead(v);
    state.samples.push([at(), +ahead.toFixed(2), v.readyState, +(v.currentTime || 0).toFixed(2)]);

    const advancing = v.currentTime > lastTime + 0.05;
    if (advancing) {
      if (!everAdvanced) {
        everAdvanced = true;
        state.startupMs = Math.round(performance.now() - t0);
      }
      lastTime = v.currentTime;
      lastAdvance = performance.now();
      if (inRebuffer) {
        state.rebuffers.push([+rebufferStart.toFixed(2), +(at() - rebufferStart).toFixed(2), +rebufferLow.toFixed(2)]);
        inRebuffer = false;
        rebufferLow = 99;
      }
    } else if (everAdvanced && !v.paused && !v.ended && performance.now() - lastAdvance > 1000) {
      // Not advancing for a second while nominally playing = a stall.
      if (!inRebuffer) {
        inRebuffer = true;
        rebufferStart = at();
      }
      rebufferLow = Math.min(rebufferLow, ahead);
    }
  }, 250);

  // ---- toolbar churn (the premium-toggle rebuild signal) -------------------
  const watchToolbar = () => {
    const host = document.getElementById("player-toolbar");
    if (!host || host.__kzWatched) return;
    host.__kzWatched = true;
    new MutationObserver((recs) => {
      if (recs.some((r) => r.type === "childList" && (r.addedNodes.length || r.removedNodes.length))) {
        state.toolbarChurn.push(at());
      }
    }).observe(host, { childList: true, subtree: true });
  };
  setInterval(watchToolbar, 1000);

  window.addEventListener("error", (e) => state.consoleErrors.push(String(e.message).slice(0, 160)));

  // ---- what the driver reads at the end -----------------------------------
  window.__KZ_DIAG = () => {
    const v = document.querySelector("video");
    let quality = null;
    try {
      quality = v?.getVideoPlaybackQuality?.() || null;
    } catch {
      /* not available everywhere */
    }
    const dur = at();
    const stallMs = state.rebuffers.reduce((s, [, d]) => s + d, 0) * 1000;
    const buf = state.samples.map((s) => s[1]);
    const tokens = {};
    for (const [, tok] of state.mediaRequests) {
      if (tok === "channel-lookup") continue;
      tokens[tok] = (tokens[tok] || 0) + 1;
    }
    return {
      durationSec: dur,
      startupMs: state.startupMs,
      playedSec: v ? +(v.currentTime || 0).toFixed(1) : 0,
      rebufferCount: state.rebuffers.length,
      rebufferSec: +(stallMs / 1000).toFixed(1),
      rebufferRatio: dur ? +(stallMs / 1000 / dur).toFixed(3) : 0,
      rebuffers: state.rebuffers,
      bufferAhead: buf.length
        ? { min: Math.min(...buf), max: Math.max(...buf), median: buf.slice().sort((a, b) => a - b)[buf.length >> 1] }
        : null,
      droppedFrames: quality?.droppedVideoFrames ?? null,
      totalFrames: quality?.totalVideoFrames ?? null,
      resolution: v ? `${v.videoWidth}x${v.videoHeight}` : null,
      remounts: state.remounts.length,
      remountTimes: state.remounts,
      toolbarChurn: state.toolbarChurn.length,
      toolbarChurnTimes: state.toolbarChurn,
      mediaRequestCount: state.mediaRequests.filter((r) => r[1] !== "channel-lookup").length,
      distinctTokens: Object.keys(tokens).length,
      requestsPerToken: tokens,
      errors: state.errors,
      consoleErrors: state.consoleErrors.slice(0, 10),
      samples: state.samples,
    };
  };
})();
