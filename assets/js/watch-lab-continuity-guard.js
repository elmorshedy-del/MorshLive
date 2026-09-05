/* CHATGPT-STAMP 2026-09-05T08:54-04:00 — WATCH-LAB-CONTINUITY-2
 *
 * KoraZero watch-page integration only. DO NOT move this into IPTV Lab.
 * The Lab is the known-good reference and remains untouched.
 *
 * Root problem on the surfaced watch page: the Lab player has explicit MPEG-TS
 * continuity handling (ERROR + ended => reconnect). The standard KoraZero watch
 * mount did not. When a live TS response ended or the buffer drained without a
 * hard browser error, the video could simply stop even though the same channel
 * kept running in IPTV Lab.
 *
 * This wrapper gives the KoraZero watch surface the missing continuity behavior
 * while preserving the exact existing KZ_LIVE_TS_CONFIG and the same signed TS
 * URL. It keeps the same <video> element mounted, silently rebuilds only the
 * underlying mpegts.js player after a real drain/end, and forwards a failure to
 * watch.js only if startup never succeeds after three attempts.
 *
 * Rollback: remove this script from watch-loader.js and delete this file.
 */
(function (global) {
  "use strict";

  const mpegts = global.mpegts;
  if (!mpegts?.createPlayer || mpegts.__kzWatchLabContinuityInstalled) return;

  const originalCreatePlayer = mpegts.createPlayer.bind(mpegts);
  const ERROR_EVENT = mpegts.Events?.ERROR;
  const RECOVERED_EOF_EVENT = mpegts.Events?.RECOVERED_EARLY_EOF;
  const WATCHDOG_MS = 1000;
  const DRAIN_GRACE_MS = 5500;
  const ERROR_GRACE_MS = 1800;
  const RECONNECT_MS = 700;
  const MAX_START_ATTEMPTS = 3;
  const MIN_ADVANCE_SECONDS = 0.08;

  function isLabBackedLiveTs(source) {
    const url = String(source?.url || "");
    return Boolean(
      source?.type === "mpegts"
      && source?.isLive
      && /\/api\/xtream\/media\//.test(url),
    );
  }

  mpegts.createPlayer = function createWatchContinuityPlayer(source, config) {
    if (!isLabBackedLiveTs(source)) return originalCreatePlayer(source, config);

    let child = null;
    let media = null;
    let destroyed = false;
    let reconnectTimer = 0;
    let errorGraceTimer = 0;
    let watchdogTimer = 0;
    let everPlayed = false;
    let startAttempts = 0;
    let lastAdvanceAt = 0;
    let lastTime = 0;
    let externalErrorListener = null;
    const forwardedListeners = [];

    const clearTimer = (id) => {
      if (id) clearTimeout(id);
    };

    const bufferedAhead = () => {
      try {
        if (!media?.buffered?.length) return 0;
        const t = Number(media.currentTime || 0);
        for (let i = 0; i < media.buffered.length; i += 1) {
          const start = media.buffered.start(i);
          const end = media.buffered.end(i);
          if (t >= start - 0.05 && t <= end + 0.05) return Math.max(0, end - t);
        }
      } catch (_) {
        // Media ranges can mutate while queried; treat it as unknown, not fatal.
      }
      return 0;
    };

    const teardownChild = () => {
      if (!child) return;
      const old = child;
      child = null;
      try { old.pause?.(); } catch (_) { /* noop */ }
      try { old.unload?.(); } catch (_) { /* noop */ }
      try { old.detachMediaElement?.(); } catch (_) { /* noop */ }
      try { old.destroy?.(); } catch (_) { /* noop */ }
    };

    const bindChild = () => {
      child = originalCreatePlayer(source, config);
      if (media) child.attachMediaElement(media);

      // Re-register non-error listeners the caller attached to the stable proxy.
      for (const [event, listener] of forwardedListeners) {
        try { child.on(event, listener); } catch (_) { /* noop */ }
      }

      if (ERROR_EVENT) {
        child.on(ERROR_EVENT, (type, detail, info) => {
          if (destroyed) return;
          clearTimer(errorGraceTimer);
          const checkpoint = Number(media?.currentTime || 0);
          errorGraceTimer = setTimeout(() => {
            errorGraceTimer = 0;
            if (destroyed) return;
            const now = Number(media?.currentTime || 0);
            if (now > checkpoint + MIN_ADVANCE_SECONDS && !media?.ended && !media?.error) {
              // Same behavior sought by the Lab: a transient parser/network event
              // that recovered while media kept advancing is not a disconnect.
              return;
            }
            scheduleReconnect(`mpegts-error:${type || "error"}:${detail || ""}`, [type, detail, info]);
          }, ERROR_GRACE_MS);
        });
      }

      if (RECOVERED_EOF_EVENT) {
        try {
          child.on(RECOVERED_EOF_EVENT, () => {
            clearTimer(errorGraceTimer);
            errorGraceTimer = 0;
          });
        } catch (_) { /* optional event */ }
      }
    };

    const startChild = () => {
      if (destroyed) return;
      teardownChild();
      bindChild();
      try { child.load(); } catch (error) {
        scheduleReconnect("load-threw", ["NetworkError", "load-threw", error]);
        return;
      }
      try {
        const attempt = child.play();
        if (attempt?.catch) attempt.catch(() => {});
      } catch (_) {
        // Autoplay rejection is handled by the page's existing unmute/play UI.
      }
    };

    const surfaceHardFailure = (args) => {
      if (typeof externalErrorListener === "function") {
        externalErrorListener(...(args || ["NetworkError", "watch-continuity-failed", null]));
      }
    };

    function scheduleReconnect(reason, failureArgs) {
      if (destroyed || reconnectTimer) return;

      if (!everPlayed) {
        startAttempts += 1;
        if (startAttempts >= MAX_START_ATTEMPTS) {
          console.warn("KoraZero Lab continuity: startup failed; returning control to watch.js", reason);
          surfaceHardFailure(failureArgs);
          return;
        }
      }

      clearTimer(errorGraceTimer);
      errorGraceTimer = 0;
      console.info("KoraZero Lab continuity: reconnecting MPEG-TS without remounting video", reason);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = 0;
        if (!destroyed) startChild();
      }, everPlayed ? RECONNECT_MS : RECONNECT_MS * Math.max(1, startAttempts));
    }

    const onPlaying = () => {
      everPlayed = true;
      startAttempts = 0;
      lastTime = Number(media?.currentTime || 0);
      lastAdvanceAt = Date.now();
    };

    const onEnded = () => {
      if (!destroyed) scheduleReconnect("media-ended");
    };

    const runWatchdog = () => {
      if (destroyed) return;
      const now = Date.now();
      if (media && everPlayed && !media.paused && !media.ended && !media.error) {
        const current = Number(media.currentTime || 0);
        if (current > lastTime + MIN_ADVANCE_SECONDS) {
          lastTime = current;
          lastAdvanceAt = now;
        } else {
          const drained = bufferedAhead() < 0.35 || media.readyState < 3;
          if (drained && lastAdvanceAt && now - lastAdvanceAt >= DRAIN_GRACE_MS) {
            lastAdvanceAt = now;
            scheduleReconnect("buffer-drained");
          }
        }
      }
      watchdogTimer = setTimeout(runWatchdog, WATCHDOG_MS);
    };

    // Stable proxy: watch.js can keep its normal activeMpegTs reference while
    // the child player is replaced underneath it, exactly where continuity is
    // needed. Nothing here changes IPTV Lab or KZ_LIVE_TS_CONFIG.
    const proxy = {
      attachMediaElement(element) {
        media = element || null;
        if (media) {
          media.addEventListener("playing", onPlaying);
          media.addEventListener("ended", onEnded);
          lastTime = Number(media.currentTime || 0);
          lastAdvanceAt = Date.now();
        }
        if (!child) bindChild();
        else child.attachMediaElement(element);
        if (!watchdogTimer) watchdogTimer = setTimeout(runWatchdog, WATCHDOG_MS);
      },
      on(event, listener) {
        if (event === ERROR_EVENT) {
          externalErrorListener = listener;
          return;
        }
        forwardedListeners.push([event, listener]);
        if (child) child.on(event, listener);
      },
      load() {
        if (!child) bindChild();
        return child.load();
      },
      play() {
        if (!child) bindChild();
        return child.play();
      },
      pause() {
        return child?.pause?.();
      },
      unload() {
        return child?.unload?.();
      },
      detachMediaElement() {
        if (media) {
          media.removeEventListener("playing", onPlaying);
          media.removeEventListener("ended", onEnded);
        }
        media = null;
        return child?.detachMediaElement?.();
      },
      destroy() {
        destroyed = true;
        clearTimer(reconnectTimer);
        clearTimer(errorGraceTimer);
        clearTimer(watchdogTimer);
        reconnectTimer = 0;
        errorGraceTimer = 0;
        watchdogTimer = 0;
        if (media) {
          media.removeEventListener("playing", onPlaying);
          media.removeEventListener("ended", onEnded);
        }
        media = null;
        teardownChild();
      },
      get __kzWatchLabContinuity() { return true; },
    };

    bindChild();
    return proxy;
  };

  mpegts.__kzWatchLabContinuityInstalled = true;
})(window);
