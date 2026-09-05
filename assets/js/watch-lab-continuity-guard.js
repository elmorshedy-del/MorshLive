/* CHATGPT-STAMP 2026-09-05T09:21-04:00 — WATCH-LAB-CONTINUITY-3
 *
 * KoraZero watch-page integration only. IPTV Lab is the known-good reference
 * and is intentionally untouched.
 *
 * Why this guard exists:
 * KoraZero mounts the Lab-resolved MPEG-TS stream inside watch.js. The Lab page
 * has continuity/recovery behavior, but the surfaced watch page previously
 * allowed a live TS response to drain/finish and then remain stopped. This
 * wrapper preserves the same signed TS URL and KZ_LIVE_TS_CONFIG while keeping
 * one stable <video> element and rebuilding only the underlying mpegts.js child
 * after a genuine drain/end.
 *
 * A reconnect is attempted only when media has stopped advancing AND buffered
 * data has drained, or after a non-recovered mpegts error. Startup failure is
 * returned to watch.js after three attempts so the existing source chain can
 * take over. No Lab source/config/quality/resolver/recovery file is modified.
 *
 * Rollback: revert the commit containing WATCH-LAB-CONTINUITY-3.
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
