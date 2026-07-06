/* Auto-captures stream/player incidents — logs locally and POSTs to /api/stream-log. */
(function (global) {
  "use strict";

  const LOG_KEY = "kz_stream_incidents";
  const VOTER_KEY = "kz_voter_id";
  const MAX_LOCAL = 80;
  const API = "/api/stream-log";
  const pending = [];
  let flushTimer = null;
  let lastSentKey = "";

  function voterId() {
    try {
      let id = localStorage.getItem(VOTER_KEY);
      if (!id) {
        id = global.crypto && global.crypto.randomUUID
          ? global.crypto.randomUUID()
          : "v-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(VOTER_KEY, id);
      }
      return id;
    } catch {
      return "anon";
    }
  }

  function readLog() {
    try {
      return JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function writeLog(arr) {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(arr.slice(-MAX_LOCAL)));
    } catch {
      /* noop */
    }
  }

  function entryKey(entry) {
    return [
      entry.event,
      entry.iframeSrc,
      entry.embedKey,
      entry.serv,
      entry.channel,
      entry.match,
    ].join("|");
  }

  function sendToServer(events) {
    if (!events || !events.length) return;
    const payload = JSON.stringify({ events });
    if (navigator.sendBeacon) {
      try {
        const blob = new Blob([payload], { type: "application/json" });
        if (navigator.sendBeacon(API, blob)) return;
      } catch {
        /* fall through */
      }
    }
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }

  function flushPending() {
    flushTimer = null;
    if (!pending.length) return;
    const batch = pending.splice(0, pending.length);
    sendToServer(batch);
  }

  function queueRemote(entry) {
    const key = entryKey(entry);
    if (key === lastSentKey) return;
    lastSentKey = key;
    pending.push(entry);
    if (!flushTimer) flushTimer = setTimeout(flushPending, 400);
  }

  function log(event, detail) {
    const entry = {
      t: new Date().toISOString(),
      event,
      voter: voterId(),
      url: global.location && global.location.href,
      ...(detail || {}),
    };
    const arr = readLog();
    arr.push(entry);
    writeLog(arr);
    queueRemote(entry);
    return entry;
  }

  function exportLog() {
    return JSON.stringify(readLog(), null, 2);
  }

  function clearLog() {
    writeLog([]);
  }

  function watchPlayerShell(shell, metaOrGetter) {
    if (!shell || shell.__kzWatchdog) return;
    shell.__kzWatchdog = true;

    function meta() {
      return typeof metaOrGetter === "function" ? metaOrGetter() : metaOrGetter;
    }

    function snapshot(why) {
      const m = meta() || {};
      const iframe = shell.querySelector("iframe");
      log(why || "player_snapshot", {
        iframeSrc: iframe && iframe.src,
        embedKey: m.embedKey,
        serv: m.serv,
        channel: m.channelId,
        match: m.matchId,
      });
    }

    snapshot("watchdog_start");

    let mutateTimer = null;
    const mo = new MutationObserver(() => {
      if (mutateTimer) return;
      mutateTimer = setTimeout(() => {
        mutateTimer = null;
        snapshot("iframe_mutated");
      }, 600);
    });
    mo.observe(shell, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });

    global.addEventListener("visibilitychange", () => {
      if (global.document.visibilityState === "visible") snapshot("tab_visible");
      else flushPending();
    });

    global.addEventListener("blur", () => {
      log("window_blur", meta());
      flushPending();
    });

    global.addEventListener("pagehide", () => flushPending());
  }

  global.StreamWatchdog = { log, export: exportLog, clear: clearLog, watch: watchPlayerShell, read: readLog };

  global.addEventListener("message", (e) => {
    const data = e.data;
    if (!data || data.type !== "kz-stream-event") return;
    log(data.event || "player_event", {
      mirrorIndex: data.mirrorIndex,
      hlsSrc: data.hlsSrc,
      videoTime: data.videoTime,
      stallSec: data.stallSec,
      paused: data.paused,
      readyState: data.readyState,
      from: "player_iframe",
    });
  });
})(window);
