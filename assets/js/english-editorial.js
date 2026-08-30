/* Final English editorial pass mirroring the Arabic product/SEO structure.
 * Keeps the English page natural while preserving the same information
 * architecture, device-local kickoff behavior and watch-page terminology.
 */
(function () {
  "use strict";

  if (document.documentElement.lang !== "en" || !window.I18N) return;

  const COPY = Object.freeze({
    "seo.title": "Today's Football Matches & Live Streams in HD | KoraZero",
    "seo.description": "Follow today's football matches on KoraZero with HD live streams when available, live scores, kick-off times, broadcast channels, commentators, lineups and match statistics.",
    "seo.ogTitle": "Today's Football Matches & Live Streams | KoraZero",
    "seo.ogDescription": "Today's football in one place: HD live streams, live scores, kick-off times, broadcast channels, commentators, lineups and match statistics.",
    "seo.twitterDescription": "Follow today's football matches, live scores, kick-off times, channels and commentators on KoraZero.",
    "seo.slogan": "Today's football matches, live scores and streams",
    "seo.keywordsAria": "Today's football information",
    "seo.kw1": "Today's matches",
    "seo.kw2": "HD live streams",
    "seo.kw3": "Live football",
    "seo.kw4": "Live scores",
    "seo.kw5": "Broadcast channels",
    "seo.kw6": "Times in your timezone",

    "hero.title": "Today's football live — <span>HD streams and live scores</span>",
    "hero.lede": "Follow today's football matches with HD live streams when available, live scores, kick-off times, broadcast channels and commentators. Match times automatically follow your device timezone.",
    "hero.noAds": "No intrusive ads or pop-ups",
    "hero.usp1": "No intrusive ads",
    "hero.usp2": "HD live streams",
    "hero.usp3": "Live scores",
    "hero.usp4": "Channel and commentator per match",
    "hero.ctaLive": "Watch live",
    "hero.seasonTitle": "Match details",
    "hero.seasonLede": "Open the match page for official lineups, live score, goals and match statistics when available.",
    "hero.ctaMatches": "Today's matches",

    "matches.title": "Today's matches",
    "matches.lede": "Today's fixtures and upcoming matches, with kick-off times, scores, broadcast channels and commentators when available.",
    "coverage.live": "Live",
    "coverage.lineups": "Lineups",
    "coverage.stats": "Stats",
    "card.lineups": "Official lineups",
    "card.stats": "Match statistics",
    "card.summary": "Match summary",
    "card.watchNow": "Watch now",
    "card.watch": "Watch",
    "status.live": "Live now",
    "status.upcoming": "Not started",
    "status.ended": "Full time",
    "live.empty": "No matches are live right now. Check today's schedule.",
    "live.recentEnded": "Just finished · coverage available",

    "faq.title": "Frequently asked questions",
    "faq.q1": "What information is available for each match?",
    "faq.a1": "Kick-off time, live score, lineups, statistics and goals, plus the broadcast channel, commentator and watch link when a stream is available.",
    "faq.q2": "Which competitions does KoraZero cover?",
    "faq.a2": "KoraZero covers major Saudi Pro League, Premier League, La Liga and UEFA Champions League matches, with other available competitions added to the schedule.",
    "faq.q3": "Which timezone are match times shown in?",
    "faq.a3": "Each match time automatically follows your device timezone.",

    "footer.about": "Follow today's matches, kick-off times, live scores, broadcast channels and commentators, then open a match page for lineups, statistics and full match details.",
    "footer.disclaimer": "Some viewing sources may be provided by third parties. Broadcast and trademark rights remain with their respective owners, and local rules apply.",

    "search.title": "Find a match",
    "search.lede": "Search by team, competition or commentator to reach the right match quickly.",
    "search.placeholder": "Team, competition or commentator…",
    "search.prompt": "Start typing a team or competition.",
    "search.none": "No matches found for “{q}”.",

    "watch.cleanView": "Clean viewing experience",
    "watch.sourceToggle": "Choose stream",
    "watch.sourcesToggle": "Channels & stream sources",
    "watch.servers": "Stream sources",
    "watch.moreServers": "More sources",
    "watch.altStreams": "Alternative sources",
    "watch.manualMirrorsTitle": "Additional sources",
    "watch.manualMirrorsPick": "Choose a source to play",
    "watch.ready": "Ready to watch",
    "watch.matchTime": "Kick-off time",
    "watch.channel": "Broadcast channel",
    "watch.commentator": "Commentator",
    "watch.tournament": "Competition",
    "watch.noMatches": "No matches are available right now",

    "card.subs": "Substitutes",
    "band.gk": "Goalkeeper",
    "band.def": "Defence",
    "band.mid": "Midfield",
    "band.fwd": "Attack",

    "srv.checking": "Checking stream sources…",
    "srv.okPrefix": "Available sources:",
    "srv.okSuffix": "— green means the source is ready to play",
    "srv.down": "No working source could be confirmed right now. You can still try the sources manually.",
    "srv.working": "Available",
    "srv.noAudio": "No audio",
    "srv.hasAudio": "Audio available",
    "srv.unreachable": "This source is unavailable right now",
    "srv.checkingOne": "Checking source…"
  });

  const baseT = window.I18N.t.bind(window.I18N);
  function interpolate(value, vars) {
    let result = String(value);
    if (!vars) return result;
    Object.entries(vars).forEach(([key, replacement]) => {
      result = result.split(`{${key}}`).join(String(replacement));
    });
    return result;
  }

  window.I18N.t = function polishedEnglish(key, vars) {
    const value = COPY[key];
    return value == null ? baseT(key, vars) : interpolate(value, vars);
  };

  function applyStaticCopy(root = document) {
    root.querySelectorAll?.("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (COPY[key] != null) el.textContent = window.I18N.t(key);
    });
    root.querySelectorAll?.("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      if (COPY[key] != null) el.innerHTML = window.I18N.t(key);
    });
  }

  function setMeta(selector, content) {
    const el = document.querySelector(selector);
    if (el && content) el.setAttribute("content", content);
  }

  function applyMeta() {
    document.title = window.I18N.t("seo.title");
    setMeta('meta[name="description"]', window.I18N.t("seo.description"));
    setMeta('meta[property="og:title"]', window.I18N.t("seo.ogTitle"));
    setMeta('meta[property="og:description"]', window.I18N.t("seo.ogDescription"));
    setMeta('meta[name="twitter:title"]', window.I18N.t("seo.ogTitle"));
    setMeta('meta[name="twitter:description"]', window.I18N.t("seo.twitterDescription"));
  }

  function removeTimezoneMarketing() {
    document.querySelectorAll(".hero-keyword").forEach((el) => {
      if (/riyadh|saudi|\bET\b|timezone/i.test(el.textContent || "")) el.remove();
    });
  }

  function apply(root = document) {
    applyStaticCopy(root);
    removeTimezoneMarketing();
    applyMeta();
  }

  let queued = false;
  const observer = new MutationObserver((mutations) => {
    if (queued || !mutations.some((m) => m.addedNodes.length)) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) apply(node);
      }));
    });
  });

  function start() {
    apply();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
