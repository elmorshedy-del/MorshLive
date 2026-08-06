/* tournament.js — World Cup 2026 archive: stage tabs, ملخص highlights */
(function () {
  "use strict";

  const t = (k, vars) => (window.I18N && window.I18N.t(k, vars)) || k;
  const teamLabel = (n) => (window.TeamNames && window.TeamNames.localize(n)) || n;

  let archive = null;
  let activeStage = "all";
  const TEAM_PAGE = document.body.classList.contains("wc-team-page");
  const MATCH_PAGE = document.body.classList.contains("wc-match-page");
  const teamSlug = new URLSearchParams(location.search).get("team");
  const matchSlugParam = new URLSearchParams(location.search).get("slug");
  let activeTeam = null;
  let activeMatch = null;

  function matchPageHref(m) {
    return window.TeamNames?.matchPageHref?.(m) || "";
  }

  function redirectToMatchPage(m) {
    const href = matchPageHref(m);
    if (href) location.replace(href);
  }

  function teamPageHref(name) {
    const slug = window.TeamNames?.slugFor?.(name);
    return slug ? `/world-cup-2026/${slug}` : "";
  }

  function teamNameHtml(name) {
    const href = teamPageHref(name);
    const label = teamLabel(name);
    if (href && !TEAM_PAGE) {
      return `<a class="team-archive-link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
    }
    return escapeHtml(label);
  }

  function teamMatches() {
    if (!archive?.matches) return [];
    if (!activeTeam) return archive.matches;
    return archive.matches.filter((m) => m.home === activeTeam || m.away === activeTeam);
  }

  function findMatchByQuery(raw) {
    const p = String(raw || "").trim();
    if (!p || !archive?.matches) return null;
    const byKey = archive.matches.find((x) => x.key === p);
    if (byKey) return byKey;
    const byId = archive.matches.find((x) => x.id === p);
    if (byId) return byId;
    const espn = p.match(/^espn-fifa\.world-(\d+)$/);
    if (espn) {
      const id = `espn-fifa.world-${espn[1]}`;
      return archive.matches.find((x) => x.id === id) || null;
    }
    return null;
  }

  function applyTeamSeo(teamEn) {
    if (!teamEn) return;
    const teamAr = window.TeamNames?.arabicFor?.(teamEn) || teamEn;
    const slug = window.TeamNames?.slugFor?.(teamEn) || teamSlug;
    const isEn = document.documentElement.lang === "en";
    const title = isEn
      ? `${teamEn} — World Cup 2026 match highlights | KoraZero`
      : `ملخصات مباريات ${teamAr} في كأس العالم 2026 | كورة زيرو`;
    const desc = isEn
      ? t("wcTeam.metaDesc", { team: teamEn })
      : t("wcTeam.metaDesc", { team: teamAr });
    document.title = title;
    const h1 = document.getElementById("wc-team-title");
    const lede = document.getElementById("wc-team-lede");
    if (h1) {
      h1.textContent = isEn
        ? t("wcTeam.title", { team: teamEn })
        : `ملخصات مباريات ${teamAr} في كأس العالم 2026`;
    }
    if (lede) lede.textContent = t("wcTeam.lede", { team: isEn ? teamEn : teamAr });
    const canonical = `https://korazero.com/world-cup-2026/${slug}`;
    const link = document.querySelector("link[rel=\"canonical\"]");
    if (link) link.href = canonical;
    const ogTitle = document.querySelector("meta[property=\"og:title\"]");
    if (ogTitle) ogTitle.content = title.replace(" | KoraZero", "");
    const ogUrl = document.querySelector("meta[property=\"og:url\"]");
    if (ogUrl) ogUrl.content = canonical;
    const metaDesc = document.querySelector("meta[name=\"description\"]");
    if (metaDesc) metaDesc.content = desc;
  }

  function applyMatchSeo(m) {
    if (!m) return;
    const homeEn = m.home;
    const awayEn = m.away;
    const homeAr = window.TeamNames?.arabicFor?.(homeEn) || homeEn;
    const awayAr = window.TeamNames?.arabicFor?.(awayEn) || awayEn;
    const slug = window.TeamNames?.matchSlug?.(homeEn, awayEn) || matchSlugParam;
    const isEn = document.documentElement.lang === "en";
    const title = isEn
      ? `${homeEn} vs ${awayEn} — World Cup 2026 highlights | KoraZero`
      : `ملخص مباراة ${homeAr} و${awayAr} في كأس العالم 2026 | كورة زيرو`;
    const desc = isEn
      ? t("wcMatch.metaDesc", { home: homeEn, away: awayEn })
      : t("wcMatch.metaDesc", { home: homeAr, away: awayAr });
    document.title = title;
    const h1 = document.getElementById("wc-match-title");
    const lede = document.getElementById("wc-match-lede");
    if (h1) {
      h1.textContent = isEn
        ? `${homeEn} vs ${awayEn} — World Cup 2026 highlights`
        : `ملخص مباراة ${homeAr} و${awayAr} في كأس العالم 2026`;
    }
    if (lede) {
      lede.textContent = isEn
        ? t("wcMatch.lede", { home: homeEn, away: awayEn })
        : t("wcMatch.lede", { home: homeAr, away: awayAr });
    }
    const canonical = `https://korazero.com/world-cup-2026/${slug}`;
    const link = document.querySelector("link[rel=\"canonical\"]");
    if (link) link.href = canonical;
    const ogTitle = document.querySelector("meta[property=\"og:title\"]");
    if (ogTitle) ogTitle.content = title.replace(" | KoraZero", "");
    const ogUrl = document.querySelector("meta[property=\"og:url\"]");
    if (ogUrl) ogUrl.content = canonical;
    const metaDesc = document.querySelector("meta[name=\"description\"]");
    if (metaDesc) metaDesc.content = desc;
  }

  async function resolveActiveTeam() {
    if (!TEAM_PAGE || !teamSlug) return null;
    try {
      const res = await fetch("/assets/data/wc-teams-index.json", { cache: "default" });
      if (res.ok) {
        const idx = await res.json();
        const hit = (idx.teams || []).find((row) => row.slug === teamSlug);
        if (hit?.name) return hit.name;
      }
    } catch { /* fallback */ }
    const names = new Set();
    for (const m of archive?.matches || []) {
      if (m.home) names.add(m.home);
      if (m.away) names.add(m.away);
    }
    return window.TeamNames?.teamFromSlug?.(teamSlug, [...names]) || null;
  }

  async function resolveActiveMatch() {
    if (!MATCH_PAGE || !matchSlugParam) return null;
    try {
      const res = await fetch("/assets/data/wc-matches-index.json", { cache: "default" });
      if (res.ok) {
        const idx = await res.json();
        const hit = (idx.matches || []).find((row) => row.slug === matchSlugParam);
        if (hit?.key) return findMatchByQuery(hit.key);
      }
    } catch { /* fallback */ }
    for (const m of archive?.matches || []) {
      const slug = window.TeamNames?.matchSlug?.(m.home, m.away);
      if (slug === matchSlugParam) return m;
    }
    return null;
  }

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

  function mergeMemesByTweetId(staticList, apiList) {
    const seen = new Set();
    const out = [];
    for (const meme of [...(staticList || []), ...(apiList || [])]) {
      const id = meme?.tweetId || meme?.url;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(meme);
    }
    return out;
  }

  function memesForMatch(m) {
    if (!m?.key) return [];
    const list = m._hydratedMemes || archive?.memes?.[m.key] || [];
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
            <span>${teamNameHtml(m.home)}</span>
          </div>
          <div class="tournament-scoreboard__score">${escapeHtml(m.score)}</div>
          <div class="tournament-scoreboard__team">
            ${m.awayBadge ? `<img class="crest" src="${escapeHtml(m.awayBadge)}" alt="" loading="lazy" />` : ""}
            <span>${teamNameHtml(m.away)}</span>
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
    const pool = teamMatches();
    if (!pool.length) return null;
    return pool
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
    const pageHref = matchPageHref(m);
    const pageLink = pageHref
      ? `<a class="tournament-match-page-link" href="${escapeHtml(pageHref)}">${escapeHtml(t("wcMatch.viewPage"))} →</a>`
      : "";
    return `
      <article class="match-card tournament-match-card" data-stage="${escapeHtml(m.stage)}" data-match-key="${escapeHtml(m.key)}">
        <div class="match-top">
          <span class="league-tag">${escapeHtml(stageLabel(m.stage))}</span>
          <span class="status-pill status-ended">${formatDate(m.kickoffUtc)}</span>
        </div>
        <div class="teams">
          <div class="team">
            ${m.homeBadge ? `<img class="crest" src="${escapeHtml(m.homeBadge)}" alt="" loading="lazy" />` : ""}
            <div class="tname">${teamNameHtml(m.home)}</div>
          </div>
          <div class="score">${escapeHtml(m.score)}</div>
          <div class="team">
            ${m.awayBadge ? `<img class="crest" src="${escapeHtml(m.awayBadge)}" alt="" loading="lazy" />` : ""}
            <div class="tname">${teamNameHtml(m.away)}</div>
          </div>
        </div>
        <div class="tournament-badges">
          ${hasHighlight ? `<span class="tournament-badge tournament-badge--hl">${clipCount > 1 ? t("tournament.badgeHighlights", { n: clipCount }) : t("tournament.badgeHighlight")}</span>` : ""}
          ${notableCount ? `<span class="tournament-badge tournament-badge--clips">${t("tournament.badgeClips", { n: notableCount })}</span>` : ""}
        </div>
        <details class="match-panel tournament-panel">
          <summary class="match-panel-toggle">${t("tournament.openMatch")}</summary>
          <div class="match-panel-body">${matchDetailHtml(m)}${pageLink}</div>
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
      { id: "all", label: t("tournament.tabAll"), count: teamMatches().length },
      ...(archive.stages || []).map((s) => ({
        id: s.id,
        label: s[lang],
        count: teamMatches().filter((m) => m.stage === s.id).length,
      })),
    ].filter((tab) => tab.id === "all" || tab.count > 0);
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
    const pool = teamMatches();
    const list = (activeStage === "all"
      ? pool
      : pool.filter((m) => m.stage === activeStage))
      .filter((m) => !latest || m.key !== latest.key);

    grid.innerHTML = list.length ? list.map((m) => matchCard(m)).join("") : "";
    if (empty) empty.hidden = !!list.length;
    if (count) count.textContent = t("tournament.matchesCount", { n: list.length });
    bindVideoLaunch(grid);
    if (window.KZTweets) window.KZTweets.bindVideoPlayers(grid);
  }

  function needsHighlightFetch(m) {
    if (window.matchNeedsReplayFetch) return window.matchNeedsReplayFetch(m);
    const { full, goals } = matchClips(m);
    const hasClips = Array.isArray(m.clips) && m.clips.length > 0;
    return !goals || !full || !hasClips;
  }

  function syncActiveMatch(enriched) {
    if (!enriched?.key) return;
    activeMatch = enriched;
    archive.matches = archive.matches.map((row) => (row.key === enriched.key ? enriched : row));
  }

  async function hydrateActiveMatchMemes() {
    if (!MATCH_PAGE || !activeMatch || !window.KZMatchMemes?.fetchMatchMemes) return;
    const staticMemes = archive?.memes?.[activeMatch.key] || [];
    const apiMemes = await window.KZMatchMemes.fetchMatchMemes(
      activeMatch.home,
      activeMatch.away,
      activeMatch.kickoffUtc,
    );
    const merged = mergeMemesByTweetId(staticMemes, apiMemes);
    if (!merged.length) return;
    activeMatch._hydratedMemes = merged;
    renderMatchPage();
  }

  async function hydrateActiveMatchMedia() {
    if (!MATCH_PAGE || !activeMatch) return;
    if (window.ensureHighlightsFromApi && needsHighlightFetch(activeMatch)) {
      const enriched = await window.ensureHighlightsFromApi([activeMatch]);
      const hit = enriched.find((row) => row.key === activeMatch.key);
      if (hit) {
        syncActiveMatch(hit);
        renderMatchPage();
      }
    }
    await hydrateActiveMatchMemes();
  }

  async function hydrateMissingHighlights() {
    if (!archive || !window.ensureHighlightsFromApi) return;
    const pending = archive.matches.filter(needsHighlightFetch);
    if (!pending.length) return;
    const enriched = await window.ensureHighlightsFromApi(pending);
    const byKey = new Map(enriched.map((m) => [m.key, m]));
    archive.matches = archive.matches.map((m) => byKey.get(m.key) || m);
    if (MATCH_PAGE && activeMatch) {
      syncActiveMatch(byKey.get(activeMatch.key) || activeMatch);
      renderMatchPage();
      await hydrateActiveMatchMemes();
      return;
    }
    renderFeatured();
    renderGrid();
  }

  function renderMatchPage() {
    const wrap = document.getElementById("tournament-featured");
    const card = document.getElementById("tournament-featured-card");
    const empty = document.getElementById("tournament-empty");
    if (!wrap || !card || !activeMatch) {
      if (wrap) wrap.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    wrap.hidden = false;
    card.innerHTML = featuredHeroHtml(activeMatch);
    bindVideoLaunch(card);
    if (window.KZTweets) window.KZTweets.bindVideoPlayers(card);
  }

  async function loadArchive() {
    const res = await fetch("/assets/data/tournament-archive.json", { cache: "default" });
    if (!res.ok) throw new Error("archive load failed");
    archive = await res.json();
    archive.matches = Array.isArray(archive.matches) ? archive.matches : [];

    if (!TEAM_PAGE && !MATCH_PAGE) {
      const raw = new URLSearchParams(location.search).get("match");
      if (raw) {
        const m = findMatchByQuery(raw);
        if (m) {
          redirectToMatchPage(m);
          return;
        }
      }
    }

    if (TEAM_PAGE) {
      activeTeam = await resolveActiveTeam();
      if (!activeTeam) {
        const grid = document.getElementById("tournament-grid");
        if (grid) grid.innerHTML = `<p style="color:var(--muted)">${t("wcTeam.notFound")}</p>`;
        return;
      }
      applyTeamSeo(activeTeam);
    }

    if (MATCH_PAGE) {
      activeMatch = await resolveActiveMatch();
      if (!activeMatch) {
        const empty = document.getElementById("tournament-empty");
        if (empty) empty.hidden = false;
        return;
      }
      applyMatchSeo(activeMatch);
      renderMatchPage();
      hydrateActiveMatchMedia().catch(() => { /* optional backfill */ });
      return;
    }

    renderFeatured();
    renderTabs();
    renderGrid();
    openMatchFromQuery();
    hydrateMissingHighlights().catch(() => { /* optional backfill */ });
  }

  function openMatchFromQuery() {
    const raw = new URLSearchParams(location.search).get("match");
    if (!raw || !archive) return;
    const m = findMatchByQuery(raw);
    if (!m) return;
    const href = matchPageHref(m);
    if (href) {
      location.replace(href);
      return;
    }
    const key = m.key;

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
