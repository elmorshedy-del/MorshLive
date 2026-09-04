/* Shared bootstrap: preserve the original translation engine, then apply the
 * editorial, visual, content-architecture, and deterministic IPTV layers. */
(function () {
  "use strict";
  const stamp = "20260904saudirollout2";
  const params = new URLSearchParams(location.search);
  const cleanPath = location.pathname.replace(/\/$/, "");
  const isolatedXtreamWatch =
    (cleanPath === "/watch.html" || cleanPath === "/watch")
    && params.get("source") === "xtream";

  // Install the match-time formatter before data.js loads. Every visitor sees
  // their own browser/device-local kickoff time plus a constant Makkah reference.
  function localMatchTimeZones(match) {
    const kickoff = match && match.kickoffUtc ? Date.parse(match.kickoffUtc) : NaN;
    if (Number.isNaN(kickoff)) return [];
    const lang = window.I18N && window.I18N.lang === "en" ? "en" : "ar";
    let zone = "";
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (_) {}
    const format = (timeZone) => new Intl.DateTimeFormat(lang, {
      ...(timeZone ? { timeZone } : {}),
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(kickoff));
    return [
      {
        key: "local",
        label: lang === "en" ? "Your local time" : "توقيتك المحلي",
        shortLabel: lang === "en" ? "Local" : "محلي",
        value: format(),
        timeZone: zone,
      },
      {
        key: "makkah",
        label: lang === "en" ? "Makkah time" : "بتوقيت مكة",
        shortLabel: lang === "en" ? "Makkah" : "مكة",
        value: format("Asia/Riyadh"),
        timeZone: "Asia/Riyadh",
      },
    ];
  }

  try {
    Object.defineProperty(window, "getMatchTimeZones", {
      configurable: true,
      get() { return localMatchTimeZones; },
      set() { /* Keep the global local + Makkah formatter when legacy data.js assigns its function. */ },
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
    if (!isolatedXtreamWatch) {
      document.write(`<script src="/assets/js/iptv-channel-resolver.js?v=${stamp}"><\/script>`);
      document.write(`<script src="/assets/js/iptv-window.js?v=${stamp}"><\/script>`);
      document.write(`<script src="/assets/js/iptv-epg-match-core.js?v=${stamp}"><\/script>`);
      document.write(`<script src="/assets/js/iptv-legacy-toggle-normalizer.js?v=${stamp}"><\/script>`);
      document.write(`<script src="/assets/js/iptv-auto.js?v=${stamp}"><\/script>`);
      document.write(`<script src="/assets/js/iptv-stage-copy.js?v=${stamp}"><\/script>`);
      document.write(`<script src="/assets/js/iptv-premium-card-click.js?v=${stamp}"><\/script>`);
    }
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
  if (!isolatedXtreamWatch) {
    addScript(`/assets/js/iptv-channel-resolver.js?v=${stamp}`, () => {
      addScript(`/assets/js/iptv-window.js?v=${stamp}`, () => {
        addScript(`/assets/js/iptv-epg-match-core.js?v=${stamp}`, () => {
          addScript(`/assets/js/iptv-legacy-toggle-normalizer.js?v=${stamp}`, () => {
            addScript(`/assets/js/iptv-auto.js?v=${stamp}`, () => {
              addScript(`/assets/js/iptv-stage-copy.js?v=${stamp}`, () => {
                addScript(`/assets/js/iptv-premium-card-click.js?v=${stamp}`);
              });
            });
          });
        });
      });
    });
  }
})();