/* tournament.js — World Cup 2026 archive: stage tabs, ملخص highlights */
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

  function replayEmbedUrl(embed) {
    try {
      const url = new URL(String(embed || ""), location.href);
      if (url.hostname === "nvtboo.vortexvisionworks.com") {
        const m = url.pathname.match(/\/embed\/([A-Za-z0-9]+)/);
        if (m) return `/replay/embed/${encodeURIComponent(m[1])}`;
      }
    } catch { /* direct fallback */ }
    return embed;
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

  function sectionHead(icon, iconMod, title, count) {
    return `
      <div class="tournament-section-head">
        <span class="tournament-section-icon tournament-section-icon--${iconMod}" aria-hidden="true">${icon}</span>
        <h4>${title}</h4>
        ${count != null ? `<span class="tournament-section-count">${count}</span>` : ""}
      </div>`;
  }

  function isTrueHighlightClip(clip) {
    if (!clip?.videoUrl) return false;
    if (clip.kind === "goals" || clip.kind === "full") return true;
    const t = String(clip.title || "");
    if (/مباراة\s+كاملة|full\s*match|match\s*replay/i.test(t)) return false;
    return /^(?:ملخص\s+مباراة|(?:اهداف|أهداف)\s+مباراة)/i.test(t)
      || (/ملخص|اهداف|أهداف/i.test(t) && /مباراة|كأس العالم/i.test(t));
  }

  function clipUsable(clip) {
    return isTrueHighlightClip(clip);
  }

  function matchClips(m) {
    const h = m.highlights || {};
    let goals = clipUsable(h.goals) ? h.goals : null;
    let full = clipUsable(h.full) ? h.full : null;
    if (!full && clipUsable(m.highlight)) {
      const sameAsGoals = goals && m.highlight.videoUrl === goals.videoUrl;
      if (!sameAsGoals) full = m.highlight;
    }
    if (!goals && clipUsable(m.highlight) && (!full || m.highlight.videoUrl !== full.videoUrl)) {
      goals = m.highlight;
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
    const embed = escapeHtml(replayEmbedUrl(highlight.videoUrl));
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
        <iframe src="${embed}" title="${escapeHtml(t("card.highlightsTitle"))}" loading="eager"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen
          sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>
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

  function clipKindLabel(kind) {
    return t(`tournament.clipKind.${kind || "clip"}`);
  }

  function notableClipsBlock(m) {
    const clips = (m.clips || [])
      .filter((clip) => clip && clip.videoUrl)
      .filter((clip) => clip.kind !== "goals" && clip.kind !== "full");
    if (!clips.length) return "";
    return `
      <div class="tournament-clips-block">
        ${sectionHead("★", "video", t("tournament.notableClipsTitle"), clips.length)}
        <div class="tournament-clips-grid">
          ${clips.map((clip) => {
            const embed = escapeHtml(replayEmbedUrl(clip.videoUrl));
            const poster = clip.thumbnail || "";
            const title = clip.title ? escapeHtml(clip.title) : escapeHtml(clipKindLabel(clip.kind));
            return `
              <button type="button" class="tournament-clip-card tournament-video-launch"
                data-embed="${embed}" aria-label="${title}">
                <span class="tournament-clip-card__media">
                  ${poster
                    ? `<img src="${assetUrl(poster)}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling&&(this.nextElementSibling.hidden=false)" /><span class="tournament-video-launch__fallback" hidden></span>`
                    : `<span class="tournament-video-launch__fallback"></span>`}
                  <span class="tournament-video-launch__play" aria-hidden="true">▶</span>
                </span>
                <span class="tournament-clip-card__kind">${escapeHtml(clipKindLabel(clip.kind))}</span>
                <span class="tournament-clip-card__title">${title}</span>
              </button>`;
          }).join("")}
        </div>
      </div>`;
  }

  function memesForMatch(m) {
    if (!archive?.memes || !m?.key) return [];
    const list = archive.memes[m.key] || [];
    return list.map((meme) => ({
      ...meme,
      home: m.home,
      away: m.away,
      score: m.score || meme.score || null,
      kickoffUtc: m.kickoffUtc || meme.kickoffUtc || null,
    }));
  }

  function memesBlock(m, mode) {
    if (!window.KZTweets) return "";
    const memes = window.KZTweets.mediaMemes(memesForMatch(m));
    if (!memes.length) return "";
    const cls = mode === "hero" ? "tournament-memes-block tournament-memes-block--hero" : "tournament-memes-block";
    return `
      <div class="${cls}">
        ${sectionHead("𝕏", "memes", t("tournament.memesTitle"), memes.length)}
        ${window.KZTweets.railHtml(memes, { showMatch: true, railClass: "kz-tweet-rail kz-tweet-rail--tournament" })}
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
    return `
      <article class="tournament-hero">
        ${scoreboardHtml(m)}
        ${m.summaryAr ? `<div class="tournament-recap"><p>${escapeHtml(m.summaryAr)}</p></div>` : ""}
        ${highlightsBlock(m, "hero")}
        ${memesBlock(m, "hero")}
      </article>`;
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

  function renderFeatured() {
    const wrap = document.getElementById("tournament-featured");
    const card = document.getElementById("tournament-featured-card");
    const latest = latestHighlightMatch();
    if (!wrap || !card || !latest) {
      if (wrap) wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    card.innerHTML = featuredHeroHtml(latest);
    bindVideoLaunch(card);
    if (window.KZTweets) window.KZTweets.bindVideoPlayers(card);
  }

  function matchDetailHtml(m) {
    return `
      <div class="tournament-detail">
        ${m.summaryAr ? `<div class="tournament-recap tournament-recap--compact"><p>${escapeHtml(m.summaryAr)}</p></div>` : ""}
        ${highlightsBlock(m, "card")}
        ${notableClipsBlock(m)}
        ${memesBlock(m, "card")}
      </div>`;
  }

  function matchCard(m) {
    const hasHighlight = hasAnyHighlight(m);
    const clipCount = (matchClips(m).goals ? 1 : 0) + (matchClips(m).full ? 1 : 0);
    const notableCount = (m.clips || []).filter((clip) => clip && clip.videoUrl).length;
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
          ${notableCount ? `<span class="tournament-badge tournament-badge--clips">${t("tournament.badgeClips", { n: notableCount })}</span>` : ""}
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

  const warmedEmbeds = new Set();
  function warmEmbed(embed) {
    if (!embed || warmedEmbeds.has(embed)) return;
    warmedEmbeds.add(embed);
    let url;
    try { url = new URL(embed, location.href); } catch { return; }
    const origin = url.origin;
    for (const [rel, href] of [["dns-prefetch", origin], ["preconnect", origin], ["prefetch", url.href]]) {
      const exists = [...document.head.querySelectorAll(`link[rel="${rel}"]`)]
        .some((link) => link.href === href);
      if (exists) continue;
      const link = document.createElement("link");
      link.rel = rel;
      link.href = href;
      if (rel === "preconnect") link.crossOrigin = "";
      if (rel === "prefetch") link.as = "document";
      document.head.appendChild(link);
    }
  }

  function openVideoModal(embed) {
    if (!embed) return;
    warmEmbed(embed);
    const modal = ensureVideoModal();
    const frame = modal.querySelector(".tournament-video-modal__frame");
    frame.innerHTML = `
      <iframe src="${embed}" title="${escapeHtml(t("card.highlightsTitle"))}" loading="eager"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen
        sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>`;
    modal.hidden = false;
    document.body.classList.add("tournament-video-modal-open");
  }

  function bindVideoLaunch(root) {
    if (!root) return;
    root.querySelectorAll(".tournament-video-launch").forEach((btn) => {
      const embedForBtn = () => btn.dataset.embed || btn.closest(".tournament-video-stage")?.dataset.embed;
      const warm = () => warmEmbed(embedForBtn());
      btn.addEventListener("pointerenter", warm, { once: true });
      btn.addEventListener("focus", warm, { once: true });
      btn.addEventListener("touchstart", warm, { once: true, passive: true });
      btn.addEventListener("click", () => {
        openVideoModal(embedForBtn());
      });
    });
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
    bindVideoLaunch(grid);
    if (window.KZTweets) window.KZTweets.bindVideoPlayers(grid);
  }

  async function loadArchive() {
    const res = await fetch("/assets/data/tournament-archive.json", { cache: "default" });
    if (!res.ok) throw new Error("archive load failed");
    archive = await res.json();
    archive.matches = Array.isArray(archive.matches) ? archive.matches : [];
    renderFeatured();
    renderTabs();
    renderGrid();
    openMatchFromQuery();
  }

  function openMatchFromQuery() {
    const key = new URLSearchParams(location.search).get("match");
    if (!key || !archive) return;
    const m = archive.matches.find((x) => x.key === key);
    if (!m) return;

    const latest = latestHighlightMatch();
    if (latest && latest.key === key) {
      const featured = document.getElementById("tournament-featured");
      if (featured) {
        featured.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }

    const card = document.querySelector(`.tournament-match-card[data-match-key="${CSS.escape(key)}"]`);
    if (!card) return;
    const panel = card.querySelector("details.tournament-panel");
    if (panel) panel.open = true;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initNav();
    loadArchive().catch(() => {
      const grid = document.getElementById("tournament-grid");
      if (grid) grid.innerHTML = `<p style="color:var(--muted)">${t("tournament.loadError")}</p>`;
    });
  });
})();
