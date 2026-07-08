/* match-memes.js — lazy-load X memes into match card panels (team/player mentions) */
(function () {
  "use strict";

  const t = (k, vars) => (window.I18N && window.I18N.t(k, vars)) || k;
  const cache = new Map();

  async function fetchMatchMemes(home, away, kickoffUtc) {
    const key = `${home}~${away}~${kickoffUtc || ""}`;
    if (cache.has(key)) return cache.get(key);
    const params = new URLSearchParams({ home, away });
    if (kickoffUtc) params.set("kickoff", kickoffUtc);
    try {
      const res = await fetch(`/api/match-memes?${params}`, { cache: "default" });
      if (!res.ok) {
        cache.set(key, []);
        return [];
      }
      const data = await res.json();
      const memes = data.memes || [];
      cache.set(key, memes);
      return memes;
    } catch {
      cache.set(key, []);
      return [];
    }
  }

  function panelShell(m) {
    return `
      <details class="match-panel match-panel--memes" data-match-id="${String(m.id || "")}" hidden>
        <summary class="match-panel-toggle">𝕏 ${t("card.memes")}</summary>
        <div class="match-panel-body match-memes-slot"></div>
      </details>`;
  }

  function renderPanel(panel, memes) {
    if (!panel || !window.KZTweets) return;
    const slot = panel.querySelector(".match-memes-slot");
    if (!slot) return;
    const list = window.KZTweets.mediaMemes(memes);
    if (!list.length) {
      panel.remove();
      return;
    }
    panel.hidden = false;
    slot.innerHTML = window.KZTweets.railHtml(list, {
      showMatch: false,
      railClass: "kz-tweet-rail kz-tweet-rail--match",
    });
    window.KZTweets.bindVideoPlayers(slot);
  }

  async function hydrateMatchMemes(root, matches) {
    if (!root || !matches?.length) return;
    const byId = new Map(matches.map((m) => [String(m.id), m]));
    const panels = root.querySelectorAll(".match-panel--memes[data-match-id]");
    await Promise.all([...panels].map(async (panel) => {
      const m = byId.get(panel.dataset.matchId);
      if (!m) {
        panel.remove();
        return;
      }
      const memes = await fetchMatchMemes(m.home, m.away, m.kickoffUtc);
      renderPanel(panel, memes);
    }));
  }

  window.KZMatchMemes = {
    panelShell,
    hydrateMatchMemes,
    fetchMatchMemes,
  };
})();
