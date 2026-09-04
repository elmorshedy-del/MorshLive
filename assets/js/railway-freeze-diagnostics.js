/* Railway-only browser freeze telemetry. No UI mutations. */
(function () {
  'use strict';
  const started = performance.now();
  let mutations = 0;
  let addedNodes = 0;
  let lastMutationAt = 0;
  let heartbeats = 0;
  let lastHref = location.href;

  function post(type, extra = {}) {
    const payload = {
      type,
      t: Math.round(performance.now()),
      wall: new Date().toISOString(),
      path: location.pathname + location.search,
      mutations,
      addedNodes,
      heartbeats,
      ...extra,
    };
    try {
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) navigator.sendBeacon('/__diag', new Blob([body], { type: 'application/json' }));
      else fetch('/__diag', { method:'POST', headers:{'content-type':'application/json'}, body, keepalive:true }).catch(()=>{});
    } catch (_) {}
  }

  window.addEventListener('error', (e) => post('error', {message:e.message, file:e.filename, line:e.lineno, col:e.colno}));
  window.addEventListener('unhandledrejection', (e) => post('unhandledrejection', {message:String(e.reason?.stack || e.reason || '')}));

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) post('longtask', {duration:Math.round(entry.duration), start:Math.round(entry.startTime)});
    }).observe({entryTypes:['longtask']});
  } catch (_) {}

  function startObserver() {
    if (!document.documentElement) return;
    const observer = new MutationObserver((records) => {
      mutations += records.length;
      for (const r of records) addedNodes += r.addedNodes?.length || 0;
      lastMutationAt = performance.now();
    });
    observer.observe(document.documentElement, {childList:true, subtree:true});
  }

  if (document.documentElement) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, {once:true});

  post('boot', {ua:navigator.userAgent});
  setInterval(() => {
    heartbeats += 1;
    const now = performance.now();
    const href = location.href;
    post('heartbeat', {
      uptime:Math.round(now-started),
      sinceMutation:lastMutationAt ? Math.round(now-lastMutationAt) : null,
      hrefChanged:href !== lastHref,
      readyState:document.readyState,
      iptvBuild:window.__KZ_MATCH_CARD_CLICK_BUILD || null,
      autoToggles:document.querySelectorAll?.('.iptv-auto-toggle').length || 0,
      sourceToggles:document.querySelectorAll?.('.watch-source-toggle').length || 0,
      matchCards:document.querySelectorAll?.('.match-card').length || 0,
    });
    lastHref = href;
  }, 1000);
})();
