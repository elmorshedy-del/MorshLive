/* Match poll — one vote per browser, persists across refresh. */
(function (global) {
  "use strict";

  const VOTER_KEY = "kz_voter_id";
  const VOTE_PREFIX = "kz_poll_vote_";
  let _config = null;
  let _configAt = 0;

  function t(key, fallback) {
    return global.I18N ? global.I18N.t(key, fallback) : fallback;
  }

  function lang() {
    return (global.I18N && global.I18N.lang) || document.documentElement.lang || "ar";
  }

  function voterId() {
    try {
      let id = localStorage.getItem(VOTER_KEY);
      if (!id) {
        id = (global.crypto && global.crypto.randomUUID)
          ? global.crypto.randomUUID()
          : "v-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(VOTER_KEY, id);
      }
      return id;
    } catch {
      return "anon-" + (navigator.userAgent || "").slice(0, 24);
    }
  }

  function savedVote(pollId) {
    try {
      return localStorage.getItem(VOTE_PREFIX + pollId) || "";
    } catch {
      return "";
    }
  }

  function saveVote(pollId, team) {
    try {
      localStorage.setItem(VOTE_PREFIX + pollId, team);
    } catch {
      /* noop */
    }
  }

  async function loadConfig() {
    if (_config && Date.now() - _configAt < 60 * 1000) return _config;
    try {
      const res = await fetch("assets/data/match-poll.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      _config = await res.json();
      _configAt = Date.now();
    } catch {
      _config = _config || null;
    }
    return _config;
  }

  function applies(cfg, match) {
    if (!cfg || !cfg.enabled || !match || !match.id) return false;
    return (cfg.matchIds || []).includes(match.id);
  }

  function teamLabel(cfg, key) {
    const team = cfg.teams && cfg.teams[key];
    if (!team) return key;
    return lang() === "en" ? (team.nameEn || team.nameAr) : (team.nameAr || team.nameEn);
  }

  function pct(n, total) {
    if (!total) return 0;
    return Math.round((n / total) * 100);
  }

  async function fetchResults(pollId) {
    const res = await fetch(`/api/poll/${encodeURIComponent(pollId)}`, { cache: "no-store" });
    if (!res.ok) throw new Error("poll fetch failed");
    return res.json();
  }

  async function submitVote(pollId, team) {
    const res = await fetch(`/api/poll/${encodeURIComponent(pollId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team, voterId: voterId() }),
    });
    if (!res.ok) throw new Error("poll vote failed");
    return res.json();
  }

  function renderResults(cfg, data, votedTeam) {
    const homeKey = cfg.homeKey || "home";
    const awayKey = cfg.awayKey || "away";
    const home = data[homeKey] || 0;
    const away = data[awayKey] || 0;
    const total = data.total != null ? data.total : home + away;
    const homePct = data.percentages ? data.percentages[homeKey] : pct(home, total);
    const awayPct = data.percentages ? data.percentages[awayKey] : pct(away, total);

    return `
      <div class="kz-poll__results">
        <div class="kz-poll__bar${votedTeam === homeKey ? " is-yours" : ""}">
          <div class="kz-poll__bar-head">
            <span>${teamLabel(cfg, homeKey)}</span>
            <b>${homePct}%</b>
          </div>
          <div class="kz-poll__track"><i style="width:${homePct}%"></i></div>
        </div>
        <div class="kz-poll__bar${votedTeam === awayKey ? " is-yours" : ""}">
          <div class="kz-poll__bar-head">
            <span>${teamLabel(cfg, awayKey)}</span>
            <b>${awayPct}%</b>
          </div>
          <div class="kz-poll__track"><i style="width:${awayPct}%"></i></div>
        </div>
        <p class="kz-poll__meta">${total.toLocaleString(lang() === "ar" ? "ar-EG" : "en-US")} ${t("poll.voters", "صوت")}</p>
      </div>`;
  }

  function renderChoices(cfg) {
    const homeKey = cfg.homeKey || "home";
    const awayKey = cfg.awayKey || "away";
    return `
      <div class="kz-poll__choices">
        <button type="button" class="kz-poll__btn" data-team="${homeKey}">${teamLabel(cfg, homeKey)}</button>
        <button type="button" class="kz-poll__btn kz-poll__btn--away" data-team="${awayKey}">${teamLabel(cfg, awayKey)}</button>
      </div>`;
  }

  function renderPoll(cfg, voted, data) {
    const title = lang() === "en" ? (cfg.titleEn || cfg.titleAr) : (cfg.titleAr || cfg.titleEn);
    return `
      <section class="kz-poll" dir="rtl" data-poll-id="${cfg.pollId}">
        <h3 class="kz-poll__title">${title}</h3>
        <div class="kz-poll__body">
          ${voted ? renderResults(cfg, data, voted) : renderChoices(cfg)}
        </div>
      </section>`;
  }

  function bindChoices(slot, cfg, onVote) {
    slot.querySelectorAll(".kz-poll__btn").forEach((btn) => {
      btn.addEventListener("click", () => onVote(btn.dataset.team, btn));
    });
  }

  async function paint(slot, cfg) {
    const prior = savedVote(cfg.pollId);
    const data = await fetchResults(cfg.pollId);
    slot.innerHTML = renderPoll(cfg, prior || null, data);

    if (prior) return;

    async function onVote(team, btn) {
      if (savedVote(cfg.pollId)) return;
      const root = slot.querySelector(".kz-poll");
      if (root) root.classList.add("kz-poll--busy");
      if (btn) btn.disabled = true;
      try {
        const next = await submitVote(cfg.pollId, team);
        saveVote(cfg.pollId, team);
        slot.innerHTML = renderPoll(cfg, team, next);
      } catch {
        if (root) root.classList.remove("kz-poll--busy");
        if (btn) btn.disabled = false;
      }
    }

    bindChoices(slot, cfg, onVote);
  }

  async function show(slot, match) {
    const cfg = await loadConfig();
    if (!slot || !applies(cfg, match)) {
      if (slot) {
        slot.innerHTML = "";
        delete slot.dataset.pollReady;
      }
      return false;
    }

    if (slot.dataset.pollReady === cfg.pollId) {
      if (savedVote(cfg.pollId)) {
        try {
          const data = await fetchResults(cfg.pollId);
          slot.innerHTML = renderPoll(cfg, savedVote(cfg.pollId), data);
        } catch {
          /* keep last paint */
        }
      }
      return true;
    }

    try {
      await paint(slot, cfg);
      slot.dataset.pollReady = cfg.pollId;
      return true;
    } catch {
      if (slot) slot.innerHTML = "";
      return false;
    }
  }

  global.MatchPoll = { show, loadConfig };
})(window);
