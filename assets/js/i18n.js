/* Shared bootstrap: preserve the original translation engine, then apply the
 * editorial, visual, and content-architecture layers across every page. */
(function () {
  "use strict";
  const stamp = "20260823architecture2";

  function writeSharedAssets() {
    document.write(`<link rel="stylesheet" href="/assets/css/dark-refresh.css?v=${stamp}">`);
    document.write(`<link rel="stylesheet" href="/assets/css/content-architecture.css?v=${stamp}">`);
    document.write(`<script src="/assets/js/i18n-core.js?v=${stamp}"><\/script>`);
    document.write(`<script src="/assets/js/site-refresh.js?v=${stamp}"><\/script>`);
    document.write(`<script src="/assets/js/content-architecture.js?v=${stamp}"><\/script>`);
  }

  if (document.readyState === "loading") {
    writeSharedAssets();
    return;
  }

  const addCss = (href) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  };
  const addScript = (src, onload) => {
    const script = document.createElement("script");
    script.src = src;
    if (onload) script.onload = onload;
    document.head.appendChild(script);
  };

  addCss(`/assets/css/dark-refresh.css?v=${stamp}`);
  addCss(`/assets/css/content-architecture.css?v=${stamp}`);
  addScript(`/assets/js/i18n-core.js?v=${stamp}`, () => {
    addScript(`/assets/js/site-refresh.js?v=${stamp}`, () => {
      addScript(`/assets/js/content-architecture.js?v=${stamp}`);
    });
  });
})();
