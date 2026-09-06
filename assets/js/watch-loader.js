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

  // CHATGPT-STAMP 2026-09-06T10:19-04:00 — WATCH-ENTRY-GATE-2
  // Cards stay clickable. The watch page enforces the T-30 window, while the
  // gate preserves watch.js boot even when fixture resolution finishes after
  // DOMContentLoaded. IPTV Lab is not modified.
  window.__KZ_WATCH_LOADER = "timing-gate";
  document.write('<script src="assets/js/watch-entry-gate.js?v=20260906entrygate2"><\/script>');
})();
