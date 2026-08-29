/* Shared bootstrap: preserve the original translation engine, then apply the
 * editorial, visual, and content-architecture layers across every page. */
(function () {
  "use strict";
  const stamp = "20260829editorial5";

  // Install the match-time formatter before data.js loads. data.js still assigns
  // getMatchTimeZones later, so intercept that assignment and keep one universal
  // visitor-local badge instead of the old Riyadh + ET pair.
  function localMatchTimeZones(match) {
    const kickoff = match && match.kickoffUtc ? Date.parse(match.kickoffUtc) : NaN;
    if (Number.isNaN(kickoff)) return [];
    const lang = window.I18N && window.I18N.lang === "en" ? "en" : "ar";
    let zone = "";
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (_) {}
    const value = new Intl.DateTimeFormat(lang, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(kickoff));
    return [{
      key: "local",
      label: lang === "en" ? "Your local time" : "توقيتك المحلي",
      shortLabel: lang === "en" ? "Local" : "محلي",
      value,
      timeZone: zone,
    }];
  }

  try {
    Object.defineProperty(window, "getMatchTimeZones", {
      configurable: true,
      get() { return localMatchTimeZones; },
      set() { /* Keep visitor-local formatter when legacy data.js assigns its function. */ },
    });
  } catch (_) {
    window.getMatchTimeZones = localMatchTimeZones;
  }

  function writeSharedAssets() {
    document.write(`<link rel="stylesheet" href="/assets/css/dark-refresh.css?v=${stamp}">`);
    document.write(`<link rel="stylesheet" href="/assets/css/content-architecture.css?v=${stamp}">`);
    document.write(`<script src="/assets/js/i18n-core.js?v=${stamp}"><\/script>`);
    document.write(`<script src="/assets/js/site-refresh.js?v=${stamp}"><\/script>`);
    document.write(`<script src="/assets/js/content-architecture.js?v=${stamp}"><\/script>`);
    document.write(`<script src="/assets/js/arabic-editorial.js?v=${stamp}"><\/script>`);
    document.write(`<script src="/assets/js/watch-arabic-editorial.js?v=${stamp}"><\/script>`);
    document.write(`<script src="/assets/js/english-editorial.js?v=${stamp}"><\/script>`);
    document.write(`<script src="/assets/js/match-stats-editorial.js?v=${stamp}"><\/script>`);
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
      addScript(`/assets/js/content-architecture.js?v=${stamp}`, () => {
        addScript(`/assets/js/arabic-editorial.js?v=${stamp}`, () => {
          addScript(`/assets/js/watch-arabic-editorial.js?v=${stamp}`, () => {
            addScript(`/assets/js/english-editorial.js?v=${stamp}`, () => {
              addScript(`/assets/js/match-stats-editorial.js?v=${stamp}`);
            });
          });
        });
      });
    });
  });
})();