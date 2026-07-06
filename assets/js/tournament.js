/* tournament.js — World Cup 2026 archive: stage tabs, ملخص, viral X memes */
(function () {
  "use strict";

  const t = (k, vars) => (window.I18N && window.I18N.t(k, vars)) || k;
  const teamLabel = (n) => (window.TeamNames && window.TeamNames.localize(n)) || n;

  let archive = null;
  let activeStage = "all";

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  /** URLs in JSON may contain &amp; — decode for src/href attributes only. */
  function assetUrl(url) {
    return escapeHtml(String(url || "").replace(/&amp;/g, "&").trim());
  }

  function formatDate(kickoffUtc) {
    if (!kickoffUtc) return "";
    try {
      const d = new Date(kickoffUtc);
      const lang = document.documentElement.lang === "en" ? "en-GB" : "ar";
      try {
        return d.toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });
      } catch {
        return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      }
    } catch { return ""; }
  }

  function formatCount(n) {
    const v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(v);
  }

  function tweetText(text) {
    return escapeHtml(String(text || "").replace(/https?:\/\/\S+/g, "").trim());
  }

  function authorInitial(author) {
    return escapeHtml(String(author || "X").charAt(0).toUpperCase());
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

  function memesNeedMedia(memes) {
    return (memes || []).some((m) => m.type === "tweet" && m.tweetId && !(m.media && m.media.length));
  }

  function memeMediaHtml(meme) {
    const item = (meme.media || [])[0];
    if (!item || !item.previewUrl) return "";
    const isVideo = item.type === "video" || item.type === "animated_gif";
    return `
      <div class="kz-tweet__media${isVideo ? " kz-tweet__media--video" : ""}">
        <img src="${assetUrl(item.previewUrl)}" alt="" loading="lazy" />
        ${isVideo ? `<span class="kz-tweet__play" aria-hidden="true">▶</span>` : ""}
      </div>`;
  }

  function memeHtml(meme) {
    if (!meme || meme.type !== "tweet" || !meme.url) return "";
    const likes = meme.likes != null ? meme.likes : 0;
    const rts = meme.retweets != null ? meme.retweets : 0;
    const avatar = meme.avatarUrl
      ? `<img class="kz-tweet__avatar kz-tweet__avatar--img" src="${assetUrl(meme.avatarUrl)}" alt="" loading="lazy" />`
      : `<span class="kz-tweet__avatar" aria-hidden="true">${authorInitial(meme.author)}</span>`;
    return `
      <a class="kz-tweet" href="${escapeHtml(meme.url)}" target="_blank" rel="noopener noreferrer">
        <div class="kz-tweet__head">
          ${avatar}
          <div class="kz-tweet__who">
            <b>@${escapeHtml(meme.author || "X")}</b>
            ${meme.postedAt ? `<time datetime="${escapeHtml(meme.postedAt)}">${formatDate(meme.postedAt)}</time>` : ""}
          </div>
          <span class="kz-tweet__x" aria-hidden="true">𝕏</span>
        </div>
        <p class="kz-tweet__text" dir="auto">${tweetText(meme.text)}</p>
        ${memeMediaHtml(meme)}
        <div class="kz-tweet__foot">
          <span class="kz-tweet__stat" title="${t("tournament.tweetLikes")}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            ${formatCount(likes)}
          </span>
          <span class="kz-tweet__stat" title="${t("tournament.tweetRts")}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h11l-3-3 1.4-1.4L22 8l-6.6 5.4L14 12l3-3H7V7zm10 10H6l3 3-1.4 1.4L2 16l6.6-5.4L10 12l-3 3h10v2z"/></svg>
            ${formatCount(rts)}
          </span>
          <span class="kz-tweet__open">${t("tournament.viewOnX")} →</span>
        </div>
      </a>`;
  }

  function sortedMemes(memes) {
    return [...(memes || [])].sort((a, b) => (b.engagement || 0) - (a.engagement || 0));
  }

  function sectionHead(icon, iconMod, title, count) {
    return `
      <div class="tournament-section-head">
        <span class="tournament-section-icon tournament-section-icon--${iconMod}" aria-hidden="true">${icon}</span>
        <h4>${title}</h4>
        ${count != null ? `<span class="tournament-section-count">${count}</span>` : ""}
      </div>`;
  }

  function matchClips(m) {
    const h = m.highlights || {};
    const goals = h.goals?.videoUrl ? h.goals : null;
    let full = h.full?.videoUrl ? h.full : null;
    if (!full && m.highlight?.videoUrl) {
      const sameAsGoals = goals && m.highlight.videoUrl === goals.videoUrl;
      if (!sameAsGoals) full = m.highlight;
    }
    return { goals, full };
  }

  function videoBlock(highlight, mode, eager, clipKind) {
    if (!highlight || !highlight.videoUrl) return "";
    const sectionTitle = clipKind === "goals"
      ? t("tournament.goalsTitle")
      : t("tournament.highlightTitle");
    const hint = clipKind === "goals" ? t("tournament.goalsHint") : t("tournament.fullHint");
    const poster = highlight.thumbnail || "";
    const title = highlight.title ? escapeHtml(highlight.title) : "";
    const embed = escapeHtml(highlight.videoUrl);
    const launch = `
      <button type="button" class="tournament-video-launch" data-embed="${embed}" aria-label="${escapeHtml(sectionTitle)}">
        ${poster
          ? `<img class="tournament-video-launch__poster" src="${assetUrl(poster)}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling&&(this.nextElementSibling.hidden=false)" /><span class="tournament-video-launch__fallback" hidden></span>`
          : `<span class="tournament-video-launch__fallback"></span>`}
        <span class="tournament-video-launch__shade"></span>
        <span class="tournament-video-launch__play" aria-hidden="true">▶</span>
        ${title ? `<span class="tournament-video-launch__label">${title}</span>` : ""}
      </button>`;
    const inline = `
      <div class="tournament-video-frame tournament-video-frame--active">
        <iframe src="${embed}" title="${escapeHtml(t("card.highlightsTitle"))}" loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe>
      </div>`;
    return `
      <div class="tournament-video-block tournament-video-block--${mode} tournament-video-block--${clipKind || "full"}">
        ${sectionHead("▶", clipKind === "goals" ? "goals" : "video", sectionTitle)}
        <p class="tournament-video-hint">${escapeHtml(hint)}</p>
        <div class="tournament-video-shell">
          <div class="tournament-video-stage" data-embed="${embed}">
            ${eager ? inline : launch}
          </div>
        </div>
      </div>`;
  }

  function highlightsBlock(m, mode) {
    const { goals, full } = matchClips(m);
    if (!goals && !full) {
      return `<p class="tournament-novideo">${t("tournament.noHighlight")}</p>`;
    }
    const blocks = [];
    if (goals) blocks.push(videoBlock(goals, mode, false, "goals"));
    if (full) blocks.push(videoBlock(full, mode, false, "full"));
    return `<div class="tournament-highlights-duo">${blocks.join("")}</div>`;
  }

  function memesBlock(memes, mode) {
    if (!memes.length) {
      return `<p class="tournament-nomemes">${t("tournament.noMemes")}</p>`;
    }
    const list = mode === "card" ? memes.slice(0, 3) : memes;
    const gridClass = mode === "hero" ? "kz-tweet-rail kz-tweet-rail--hero" : "kz-tweet-stack";
    return `
      <div class="tournament-memes-block tournament-memes-block--${mode}">
        ${sectionHead("𝕏", "x", t("tournament.memesTitle"), memes.length)}
        <div class="${gridClass}">${list.map(memeHtml).join("")}</div>
      </div>`;
  }

  function scoreboardHtml(m) {
    return `
      <div class="tournament-scoreboard">
        <div class="tournament-scoreboard__meta">
          <span class="league-tag">${escapeHtml(stageLabel(m.stage))}</span>
          <time class="status-pill status-ended">${formatDate(m.kickoffUtc)}</time>
        </div>
        <div class="tournament-scoreboard__teams">
          <div class="tournament-scoreboard__team">
            ${m.homeBadge ? `<img class="crest" src="${escapeHtml(m.homeBadge)}" alt="" loading="lazy" />` : ""}
            <span>${teamLabel(m.home)}</span>
          </div>
          <div class="tournament-scoreboard__score">${escapeHtml(m.score)}</div>
          <div class="tournament-scoreboard__team">
            ${m.awayBadge ? `<img class="crest" src="${escapeHtml(m.awayBadge)}" alt="" loading="lazy" />` : ""}
            <span>${teamLabel(m.away)}</span>
          </div>
        </div>
      </div>`;
  }

  function featuredHeroHtml(m) {
    const memes = sortedMemes((archive.memes && archive.memes[m.key]) || []);
    return `
      <article class="tournament-hero">
        ${scoreboardHtml(m)}
        ${m.summaryAr ? `<div class="tournament-recap"><p>${escapeHtml(m.summaryAr)}</p></div>` : ""}
        ${highlightsBlock(m, "hero")}
        ${memesBlock(memes, "hero")}
      </article>`;
  }

  async function fetchMemesForMatch(m, force) {
    const local = sortedMemes((archive.memes && archive.memes[m.key]) || []);
    if (!m.home || !m.away) return local;
    if (!force && local.length && !memesNeedMedia(local)) return local;
    const q = new URLSearchParams({
      home: m.home,
      away: m.away,
      kickoff: m.kickoffUtc || "",
    });
    try {
      const res = await fetch(`/api/match-memes?${q}`, { cache: "no-store" });
      if (!res.ok) return local;
      const data = await res.json();
      if (data.memes?.length) {
        archive.memes[m.key] = data.memes;
        return sortedMemes(data.memes);
      }
    } catch { /* local */ }
    return local;
  }

  function hasAnyHighlight(m) {
    const { goals, full } = matchClips(m);
    return !!(goals || full);
  }

  function latestHighlightMatch() {
    if (!archive?.matches?.length) return null;
    return archive.matches
      .filter((m) => hasAnyHighlight(m) && m.kickoffUtc)
      .sort((a, b) => Date.parse(b.kickoffUtc) - Date.parse(a.kickoffUtc))[0] || null;
  }

  async function renderFeaturedAsync() {
    const wrap = document.getElementById("tournament-featured");
    const card = document.getElementById("tournament-featured-card");
    const latest = latestHighlightMatch();
    if (!wrap || !card || !latest) {
      if (wrap) wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    await fetchMemesForMatch(latest);
    card.innerHTML = featuredHeroHtml(latest);
    bindVideoLaunch(card);
  }

  function renderFeatured() {
    renderFeaturedAsync().catch(() => { /* retry on enrich */ });
  }

  function matchDetailHtml(m) {
    const memes = sortedMemes((archive.memes && archive.memes[m.key]) || []);
    return `
      <div class="tournament-detail">
        ${m.summaryAr ? `<div class="tournament-recap tournament-recap--compact"><p>${escapeHtml(m.summaryAr)}</p></div>` : ""}
        ${highlightsBlock(m, "card")}
        ${memesBlock(memes, "card")}
      </div>`;
  }

  function matchCard(m) {
    const memes = (archive.memes && archive.memes[m.key]) || [];
    const hasMemes = memes.length > 0;
    const hasHighlight = hasAnyHighlight(m);
    const clipCount = (matchClips(m).goals ? 1 : 0) + (matchClips(m).full ? 1 : 0);
    return `
      <article class="match-card tournament-match-card" data-stage="${escapeHtml(m.stage)}" data-match-key="${escapeHtml(m.key)}">
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
          ${hasHighlight ? `<span class="tournament-badge tournament-badge--hl">${clipCount > 1 ? t("tournament.badgeHighlights", { n: clipCount }) : t("tournament.badgeHighlight")}</span>` : ""}
          ${hasMemes ? `<span class="tournament-badge tournament-badge--meme">${t("tournament.badgeMemes", { n: memes.length })}</span>` : ""}
        </div>
        <details class="match-panel tournament-panel">
          <summary class="match-panel-toggle">${t("tournament.openMatch")}</summary>
          <div class="match-panel-body">${matchDetailHtml(m)}</div>
        </details>
      </article>`;
  }

  function ensureVideoModal() {
    let el = document.getElementById("tournament-video-modal");
    if (el) return el;
    el = document.createElement("div");
    el.id = "tournament-video-modal";
    el.className = "tournament-video-modal";
    el.hidden = true;
    el.innerHTML = `
      <div class="tournament-video-modal__backdrop" data-close tabindex="-1"></div>
      <div class="tournament-video-modal__dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(t("tournament.highlightTitle"))}">
        <div class="tournament-video-modal__bar">
          <span class="tournament-video-modal__title">${escapeHtml(t("tournament.highlightTitle"))}</span>
          <button type="button" class="tournament-video-modal__close" data-close aria-label="Close">×</button>
        </div>
        <div class="tournament-video-modal__frame"></div>
      </div>`;
    document.body.appendChild(el);
    const close = () => closeVideoModal();
    el.querySelectorAll("[data-close]").forEach((node) => node.addEventListener("click", close));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el.hidden) close();
    });
    return el;
  }

  function closeVideoModal() {
    const el = document.getElementById("tournament-video-modal");
    if (!el) return;
    el.hidden = true;
    const frame = el.querySelector(".tournament-video-modal__frame");
    if (frame) frame.innerHTML = "";
    document.body.classList.remove("tournament-video-modal-open");
  }

  function openVideoModal(embed) {
    if (!embed) return;
    const modal = ensureVideoModal();
    const frame = modal.querySelector(".tournament-video-modal__frame");
    frame.innerHTML = `
      <iframe src="${embed}" title="${escapeHtml(t("card.highlightsTitle"))}" loading="lazy"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe>`;
    modal.hidden = false;
    document.body.classList.add("tournament-video-modal-open");
  }

  function bindVideoLaunch(root) {
    if (!root) return;
    root.querySelectorAll(".tournament-video-launch").forEach((btn) => {
      btn.addEventListener("click", () => {
        const embed = btn.dataset.embed || btn.closest(".tournament-video-stage")?.dataset.embed;
        openVideoModal(embed);
      });
    });
  }

  async function refreshMatchPanel(card) {
    const key = card?.dataset?.matchKey;
    if (!key || !archive) return;
    const m = archive.matches.find((x) => x.key === key);
    if (!m) return;
    await fetchMemesForMatch(m, true);
    const body = card.querySelector(".match-panel-body");
    if (body) {
      body.innerHTML = matchDetailHtml(m);
      bindVideoLaunch(body);
    }
  }

  function bindPanelMemes(root) {
    if (!root) return;
    root.querySelectorAll(".tournament-panel").forEach((panel) => {
      panel.addEventListener("toggle", () => {
        if (!panel.open) return;
        const card = panel.closest(".tournament-match-card");
        refreshMatchPanel(card).catch(() => { /* static memes */ });
      });
    });
  }

  function bindLazyMedia(root) {
    bindVideoLaunch(root);
    bindPanelMemes(root);
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

    grid.innerHTML = list.length ? list.map((m) => matchCard(m)).join("") : "";
    if (empty) empty.hidden = !!list.length;
    if (count) count.textContent = t("tournament.matchesCount", { n: list.length });
    bindLazyMedia(grid);
  }

  async function enrichMemesFromApi() {
    if (!archive) return;
    const needs = archive.matches.filter((m) => {
      const memes = archive.memes[m.key] || [];
      return memes.length ? memesNeedMedia(memes) : !!(m.highlight?.videoUrl);
    });
    if (!needs.length) return;
    await Promise.all(needs.map((m) => fetchMemesForMatch(m, true)));
  }

  async function loadArchive() {
    const res = await fetch("/assets/data/tournament-archive.json", { cache: "no-store" });
    if (!res.ok) throw new Error("archive load failed");
    archive = await res.json();
    archive.memes = archive.memes || {};
    archive.matches = Array.isArray(archive.matches) ? archive.matches : [];
    renderFeatured();
    renderTabs();
    renderGrid();
    enrichMemesFromApi()
      .then(() => { renderFeatured(); renderGrid(); })
      .catch(() => { /* static archive is enough */ });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initNav();
    loadArchive().catch(() => {
      const grid = document.getElementById("tournament-grid");
      if (grid) grid.innerHTML = `<p style="color:var(--muted)">${t("tournament.loadError")}</p>`;
    });
  });
})();
