/* Shared bootstrap: preserve the original translation engine, then apply the
 * KoraZero editorial + visual refresh across every page that loads i18n.js. */
(function () {
  "use strict";
  const stamp = "20260823editorial";
  if (document.readyState === "loading") {
    document.write(`<link rel="stylesheet" href="/assets/css/dark-refresh.css?v=${stamp}">`);
    document.write(`<script src="/assets/js/i18n-core.js?v=${stamp}"><\/script>`);
    document.write(`<script src="/assets/js/site-refresh.js?v=${stamp}"><\/script>`);
    return;
  }
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = `/assets/css/dark-refresh.css?v=${stamp}`;
  document.head.appendChild(css);
  const core = document.createElement("script");
  core.src = `/assets/js/i18n-core.js?v=${stamp}`;
  core.onload = () => {
    const refresh = document.createElement("script");
    refresh.src = `/assets/js/site-refresh.js?v=${stamp}`;
    document.head.appendChild(refresh);
  };
  document.head.appendChild(core);
})();
