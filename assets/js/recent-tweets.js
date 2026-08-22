/* recent-tweets.js — home: title + top meme media strip.
 * Live /api/recent-memes first; fall back to the World Cup meme archive
 * so the X rail does not vanish when the live endpoint is empty. */
(function () {
  "use strict";

  function flattenMemeArchive(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.memes)) return data.memes;
    return Object.values(data).flatMap((value) => (Array.isArray(value) ? value : []));
  }

  async function fetchJson(url, cache) {
    const res = await fetch(url, { cache });
    if (!res.ok) return null;
    return res.json();
  }

  async function fetchRecentTweets() {
    try {
      const live = await fetchJson("/api/recent-memes", "no-store");
      if (live?.memes?.length) return live.memes;
    } catch { /* use static archive */ }
    try {
      const archived = await fetchJson("/assets/data/match-memes.json", "default");
      return flattenMemeArchive(archived).slice(0, 24);
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
      compact: true,
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
