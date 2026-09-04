/* Railway-only browser freeze telemetry. This file is inert unless injected by the Railway diagnostic server. */
(function () {
  'use strict';
  const started = performance.now();
  let mutations = 0;
  let addedNodes = 0;
  let lastMutationAt = 0;
  let heartbeats = 0;

  function post(type, extra = {}) {
    try {
      const payload = JSON.stringify({
        type,
        t: Math.round(performance.now()),
        wall: new Date().toISOString(),
        path: location.pathname + location.search,
        mutations,
        addedNodes,
        heartbeats,
        ...extra,
      });
      if (navigator.sendBeacon) navigator.sendBeacon('/__diag', new Blob([payload], { type: 'application/json' }));
      else fetch('/__diag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    } catch (_) {}
  }

  window.addEventListener('error', (e) => post('error', { message: e.message, file: e.filename, line: e.lineno, col: e.colno }));
  window.addEventListener('unhandledrejection', (e) => post('unhandledrejection', { message: String(e.reason?.stack || e.reason || '') }));
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) post('longtask', { duration: Math.round(entry.duration), start: Math.round(entry.startTime) });
    }).observe({ entryTypes: ['longtask'] });
  } catch (_) {}

  const observe = () => {
    if (!document.documentElement) return;
    new MutationObserver((records) => {
      mutations += records.length;
      for (const r of records) addedNodes += r.addedNodes?.length || 0;
      lastMutationAt = performance.now();
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.documentElement) observe();
  else document.addEventListener('DOMContentLoaded', observe, { once: true });

  post('boot', { ua: navigator.userAgent });
  setInterval(() => {
    heartbeats += 1;
    const now = performance.now();
    post('heartbeat', {
      uptime: Math.round(now - started),
      sinceMutation: lastMutationAt ? Math.round(now - lastMutationAt) : null,
      readyState: document.readyState,
      autoToggles: document.querySelectorAll?.('.iptv-auto-toggle').length || 0,
      sourceToggles: document.querySelectorAll?.('.watch-source-toggle').length || 0,
      matchCards: document.querySelectorAll?.('.match-card').length || 0,
    });
  }, 1000);
})();
