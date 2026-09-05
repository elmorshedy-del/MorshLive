/* Select the isolated Xtream player only for explicit source=xtream URLs. */
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const xtream = params.get("source") === "xtream" && params.get("portal") && params.get("stream");
  const src = xtream
    ? "assets/js/watch-xtream.js?v=20260904bindingfix1"
    : "assets/js/watch.js?v=20260905chatgpt0808";
  window.__KZ_WATCH_LOADER = xtream ? "xtream" : "standard";
  if (xtream) {
    document.write('<script src="assets/js/mpegts-recovery-guard.js?v=20260904stablets1"><\/script>');
  }
  document.write(`<script src="${src}"><\/script>`);
})();
