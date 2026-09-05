/* Select the isolated Xtream player only for explicit source=xtream URLs. */
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const xtream = params.get("source") === "xtream" && params.get("portal") && params.get("stream");
  const src = xtream
    ? "assets/js/watch-xtream.js?v=20260904bindingfix1"
    : "assets/js/watch.js?v=20260905gate1";
  window.__KZ_WATCH_LOADER = xtream ? "xtream" : "standard";
  if (xtream) {
    document.write('<script src="assets/js/mpegts-recovery-guard.js?v=20260904stablets1"><\/script>');
  } else {
    // CHATGPT-STAMP 2026-09-05T08:54-04:00 — WATCH-LAB-CONTINUITY-2
    // KoraZero surface only. IPTV Lab remains byte-for-byte untouched.
    document.write('<script src="assets/js/watch-lab-continuity-guard.js?v=20260905chatgpt0854"><\/script>');
  }
  document.write(`<script src="${src}"><\/script>`);
})();