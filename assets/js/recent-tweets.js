/* recent-tweets.js — home page: trending X media from last 24h, all recent matches */
(function () {
  "use strict";

  const t = (k, vars) => (window.I18N && window.I18N.t(k, vars)) || k;

  async function fetchRecentTweets() {
    try {
      const res = await fetch("/api/recent-memes", { cache: "no-store" });
      if (!res.ok) return [];
      const data = await res.json();
      return data.memes || [];
    } catch {
      return [];
    }
  }

  function renderRecentTweets(memes) {
    const section = document.getElementById("recent-tweets");
    const rail = document.getElementById("recent-tweets-rail");
    const count = document.getElementById("recent-tweets-count");
    if (!section || !rail || !window.KZTweets) return;

    const list = window.KZTweets.mediaMemes(memes);
    if (!list.length) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    if (count) count.textContent = t("home.recentTweetsCount", { n: list.length });
    rail.innerHTML = window.KZTweets.railHtml(list, {
      showMatch: true,
      railClass: "kz-tweet-rail kz-tweet-rail--home",
    });
    window.KZTweets.bindVideoPlayers(rail);
  }

  async function loadRecentTweets() {
    const memes = await fetchRecentTweets();
    renderRecentTweets(memes);
    return memes;
  }

  window.loadRecentTweets = loadRecentTweets;

  document.addEventListener("DOMContentLoaded", () => {
    loadRecentTweets().catch(() => { /* optional rail */ });
    setInterval(() => loadRecentTweets().catch(() => {}), 3 * 60 * 1000);
  });
})();
