/* recent-tweets.js — home: title + top meme media strip */
(function () {
  "use strict";

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
    if (!section || !rail || !window.KZTweets) return;

    const list = window.KZTweets.mediaMemes(memes, { preserveOrder: true });
    if (!list.length) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    rail.innerHTML = window.KZTweets.railHtml(list, {
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
  });
})();
