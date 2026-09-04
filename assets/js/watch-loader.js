/* Select the isolated Xtream player only for explicit source=xtream URLs. */
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const xtream = params.get("source") === "xtream" && params.get("portal") && params.get("stream");
  const src = xtream
    ? "assets/js/watch-xtream.js?v=20260904bindingfix1"
    : "assets/js/watch.js?v=20260904noreload1";
  window.__KZ_WATCH_LOADER = xtream ? "xtream" : "standard";
  document.write(`<script src="${src}"><\/script>`);
})();
