/* Select the isolated Xtream player only for explicit source=xtream URLs. */
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const xtream = params.get("source") === "xtream" && params.get("portal") && params.get("stream");
  if (xtream) {
    window.__KZ_WATCH_LOADER = "xtream";
    document.write('<script src="assets/js/mpegts-recovery-guard.js?v=20260904stablets1"><\/script>');
    document.write('<script src="assets/js/watch-xtream.js?v=20260904bindingfix1"><\/script>');
    return;
  }

  // CHATGPT-STAMP 2026-09-05 — WATCH-ENTRY-GATE
  // Keep every match card/link clickable, but let the watch page itself enforce
  // the existing T-30 through post-match TV window before any player code loads.
  // IPTV Lab is not modified.
  window.__KZ_WATCH_LOADER = "timing-gate";
  document.write('<script src="assets/js/watch-entry-gate.js?v=20260905entrygate1"><\/script>');
})();