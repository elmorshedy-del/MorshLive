/* Captures stream/player incidents for debugging (kooracity overlays, redirects, etc.).
 * User can run StreamWatchdog.export() in console or share the copied JSON next time. */
(function (global) {
  "use strict";

  const LOG_KEY = "kz_stream_incidents";
  const MAX = 80;

  function readLog() {
    try {
      return JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function writeLog(arr) {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(arr.slice(-MAX)));
    } catch {
      /* noop */
    }
  }

  function log(event, detail) {
    const entry = {
      t: new Date().toISOString(),
      event,
      url: global.location && global.location.href,
      ...(detail || {}),
    };
    const arr = readLog();
    arr.push(entry);
    writeLog(arr);
    if (global.console) console.warn("[KZ Stream]", event, entry);
    return entry;
  }

  function exportLog() {
    const text = JSON.stringify(readLog(), null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    return text;
  }

  function clearLog() {
    writeLog([]);
  }

  function watchPlayerShell(shell, meta) {
    if (!shell || shell.__kzWatchdog) return;
    shell.__kzWatchdog = true;

    function snapshot(why) {
      const iframe = shell.querySelector("iframe");
      log(why || "player_snapshot", {
        iframeSrc: iframe && iframe.src,
        embedKey: meta && meta.embedKey,
        serv: meta && meta.serv,
        channel: meta && meta.channelId,
        match: meta && meta.matchId,
      });
    }

    snapshot("watchdog_start");

    const mo = new MutationObserver(() => snapshot("iframe_mutated"));
    mo.observe(shell, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });

    global.addEventListener("visibilitychange", () => {
      if (global.document.visibilityState === "visible") snapshot("tab_visible");
    });

    global.addEventListener("blur", () => log("window_blur", { embedKey: meta && meta.embedKey }));
  }

  global.StreamWatchdog = { log, export: exportLog, clear: clearLog, watch: watchPlayerShell, read: readLog };
})(window);
