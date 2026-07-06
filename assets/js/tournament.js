/* tournament.js — World Cup 2026 archive: stage tabs, ملخص, viral X memes */
(function () {
  const t = (k, vars) => (window.I18N && window.I18N.t(k, vars)) || k;
  const teamLabel = (n) => (window.TeamNames && window.TeamNames.label(n)) || n;

  let archive = null;
  let activeStage = "all";
  let twitterWidgetsLoaded = false;

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function formatDate(kickoffUtc) {
    if (!kickoffUtc) return "";
    try {
      const d = new Date(kickoffUtc);
      return d.toLocaleDateString(document.documentElement.lang === "en" ? "en-GB" : "ar-SA", {
        day: "numeric", month: "short", year: "numeric",
      });
    } catch { return ""; }
  }

  function stageLabel(stage) {
    if (!stage) return "";
    const lang = document.documentElement.lang === "en" ? "labelEn" : "labelAr";
    const found = (archive.stages || []).find((s) => s.id === stage);
    return found ? found[lang] : stage;
  }

  function initNav() {
    const toggle = document.querySelector(".nav-toggle");
    const links = document.querySelector(".nav-links");
    if (toggle && links) {
      toggle.addEventListener("click", () => links.classList.toggle("open"));
    }
  }

  function loadTwitterWidgets() {
    if (twitterWidgetsLoaded) {
      if (window.twttr && window.twttr.widgets) window.twttr.widgets.load();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://platform.twitter.com/widgets.js";
    s.async = true;
    s.charset = "utf-8";
    s.onload = () => {
      twitterWidgetsLoaded = true;
      if (window.twttr && window.twttr.widgets) window.twttr.widgets.load();
    };
    document.body.appendChild(s);
  }

  function memeHtml(meme) {
    if (!meme || meme.type !== "tweet" || !meme.url) return "";
    return `
      <div class="meme-card meme-card--tweet">
        <blockquote class="twitter-tweet" data-dnt="true" data-theme="dark">
          <a href="${escapeHtml(meme.url)}"></a>
        </blockquote>
        ${meme.author ? `<div class="meme-meta">@${escapeHtml(meme.author)}</div>` : ""}
      </div>`;
  }

  function matchDetailHtml(m) {
    const memes = (archive.memes && archive.memes[m.key]) || [];
    const highlight = m.highlight;
    const highlightBlock = highlight && highlight.videoUrl
      ? `<div class="tournament-highlight">
           <h4>${t("tournament.highlightTitle")}</h4>
           <div class="match-highlight-video">
             <iframe src="${escapeHtml(highlight.videoUrl)}" title="${escapeHtml(t("card.highlightsTitle"))}" loading="lazy"
               allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen
               sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe>
           </div>
         </div>`
      : `<p class="tournament-novideo">${t("tournament.noHighlight")}</p>`;

    const memesBlock = memes.length
      ? `<div class="tournament-memes">
           <h4>${t("tournament.memesTitle")}</h4>
           <div class="meme-grid">${memes.map(memeHtml).join("")}</div>
         </div>`
      : `<p class="tournament-nomemes">${t("tournament.noMemes")}</p>`;

    return `
      <div class="tournament-detail">
        ${m.summaryAr ? `<p class="match-summary-text">${escapeHtml(m.summaryAr)}</p>` : ""}
        ${highlightBlock}
        ${memesBlock}
      </div>`;
  }

  function matchCard(m) {
    const memes = (archive.memes && archive.memes[m.key]) || [];
    const hasMemes = memes.length > 0;
    const hasHighlight = !!(m.highlight && m.highlight.videoUrl);
    return `
      <article class="match-card tournament-match-card" data-stage="${escapeHtml(m.stage)}">
        <div class="match-top">
          <span class="league-tag">${escapeHtml(stageLabel(m.stage))}</span>
          <span class="status-pill status-ended">${formatDate(m.kickoffUtc)}</span>
        </div>
        <div class="teams">
          <div class="team">
            ${m.homeBadge ? `<img class="crest" src="${escapeHtml(m.homeBadge)}" alt="" loading="lazy" />` : ""}
            <div class="tname">${teamLabel(m.home)}</div>
          </div>
          <div class="score">${escapeHtml(m.score)}</div>
          <div class="team">
            ${m.awayBadge ? `<img class="crest" src="${escapeHtml(m.awayBadge)}" alt="" loading="lazy" />` : ""}
            <div class="tname">${teamLabel(m.away)}</div>
          </div>
        </div>
        <div class="tournament-badges">
          ${hasHighlight ? `<span class="tournament-badge tournament-badge--hl">${t("tournament.badgeHighlight")}</span>` : ""}
          ${hasMemes ? `<span class="tournament-badge tournament-badge--meme">${t("tournament.badgeMemes", { n: memes.length })}</span>` : ""}
        </div>
        <details class="match-panel tournament-panel">
          <summary class="match-panel-toggle">${t("tournament.openMatch")}</summary>
          <div class="match-panel-body">${matchDetailHtml(m)}</div>
        </details>
      </article>`;
  }

  function renderTabs() {
    const wrap = document.getElementById("tournament-tabs");
    if (!wrap || !archive) return;
    const lang = document.documentElement.lang === "en" ? "labelEn" : "labelAr";
    const tabs = [
      { id: "all", label: t("tournament.tabAll"), count: archive.matchCount },
      ...(archive.stages || []).map((s) => ({
        id: s.id,
        label: s[lang],
        count: s.matchCount,
      })),
    ];
    wrap.innerHTML = tabs.map((tab) => `
      <button type="button" class="filter-btn tournament-tab${activeStage === tab.id ? " active" : ""}"
              data-stage="${tab.id}" role="tab" aria-selected="${activeStage === tab.id}">
        ${escapeHtml(tab.label)} <span class="tournament-tab-count">${tab.count}</span>
      </button>`).join("");

    wrap.querySelectorAll(".tournament-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeStage = btn.dataset.stage;
        renderTabs();
        renderGrid();
      });
    });
  }

  function latestHighlightMatch() {
    if (!archive?.matches?.length) return null;
    return archive.matches
      .filter((m) => m.highlight?.videoUrl && m.kickoffUtc)
      .sort((a, b) => Date.parse(b.kickoffUtc) - Date.parse(a.kickoffUtc))[0] || null;
  }

  function featuredMatchCard(m) {
    const card = matchCard(m);
    return card
      .replace('class="match-card tournament-match-card"', 'class="match-card tournament-match-card tournament-match-card--featured"')
      .replace("<details", '<details open')
      .replace('class="match-panel tournament-panel"', 'class="match-panel tournament-panel tournament-panel--featured"');
  }

  function renderFeatured() {
    const wrap = document.getElementById("tournament-featured");
    const card = document.getElementById("tournament-featured-card");
    const latest = latestHighlightMatch();
    if (!wrap || !card || !latest) {
      if (wrap) wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    card.innerHTML = featuredMatchCard(latest);
    if ((archive.memes[latest.key] || []).length) loadTwitterWidgets();
  }

  function renderGrid() {
    const grid = document.getElementById("tournament-grid");
    const empty = document.getElementById("tournament-empty");
    const count = document.getElementById("tournament-count");
    if (!grid || !archive) return;

    const latest = latestHighlightMatch();
    const list = (activeStage === "all"
      ? archive.matches
      : archive.matches.filter((m) => m.stage === activeStage))
      .filter((m) => !latest || m.key !== latest.key);

    grid.innerHTML = list.length ? list.map(matchCard).join("") : "";
    if (empty) empty.hidden = !!list.length;
    if (count) count.textContent = t("tournament.matchesCount", { n: list.length });

    if (list.some((m) => (archive.memes && archive.memes[m.key] || []).length)) loadTwitterWidgets();
  }

  async function enrichMemesFromApi() {
    if (!archive) return;
    const needs = archive.matches.filter(
      (m) => m.highlight?.videoUrl && !(archive.memes[m.key] || []).length
    );
    if (!needs.length) return;
    await Promise.all(needs.map(async (m) => {
      const q = new URLSearchParams({
        home: m.home,
        away: m.away,
        kickoff: m.kickoffUtc || "",
      });
      try {
        let res = await fetch(`/api/match-memes?${q}`);
        if (!res.ok) return;
        let data = await res.json();
        if (!data.memes?.length) {
          res = await fetch(`/api/match-memes?${q}&live=1`);
          if (res.ok) data = await res.json();
        }
        if (data.memes?.length) archive.memes[m.key] = data.memes;
      } catch { /* static archive */ }
    }));
  }

  async function loadArchive() {
    const res = await fetch("assets/data/tournament-archive.json", { cache: "no-store" });
    if (!res.ok) throw new Error("archive load failed");
    archive = await res.json();
    await enrichMemesFromApi();
    renderFeatured();
    renderTabs();
    renderGrid();
  }

  document.addEventListener("DOMContentLoaded", () => {
    initNav();
    loadArchive().catch(() => {
      const grid = document.getElementById("tournament-grid");
      if (grid) grid.innerHTML = `<p style="color:var(--muted)">${t("tournament.loadError")}</p>`;
    });
  });
})();
