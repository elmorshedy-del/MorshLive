/* Shared replay UI — goals/full highlights + notable moments on match cards. */
(function () {
  "use strict";

  const t = (k, vars) => (window.I18N && window.I18N.t(k, vars)) || k;

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

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

  function isTrueHighlightClip(clip) {
    if (!clip?.videoUrl) return false;
    if (clip.kind === "goals" || clip.kind === "full") return true;
    const title = String(clip.title || "");
    if (/مباراة\s+كاملة|full\s*match|match\s*replay/i.test(title)) return false;
    return /^(?:ملخص\s+مباراة|(?:اهداف|أهداف)\s+مباراة)/i.test(title)
      || (/ملخص|اهداف|أهداف/i.test(title) && /مباراة|كأس العالم/i.test(title));
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

  function clipKindLabel(kind) {
    return t(`tournament.clipKind.${kind || "clip"}`);
  }

  function sectionHead(icon, iconMod, title, count) {
    return `
      <div class="tournament-section-head">
        <span class="tournament-section-icon tournament-section-icon--${iconMod}" aria-hidden="true">${icon}</span>
        <h4>${title}</h4>
        ${count != null ? `<span class="tournament-section-count">${count}</span>` : ""}
      </div>`;
  }

  function videoLaunchBtn(highlight, clipKind) {
    if (!highlight?.videoUrl) return "";
    const sectionTitle = clipKind === "goals"
      ? t("tournament.goalsTitle")
      : t("tournament.highlightTitle");
    const poster = highlight.thumbnail || "";
    const title = highlight.title ? escapeHtml(highlight.title) : "";
    const embed = escapeHtml(replayEmbedUrl(highlight.videoUrl));
    return `
      <button type="button" class="tournament-video-launch match-replay-launch" data-embed="${embed}" aria-label="${escapeHtml(sectionTitle)}">
        ${poster
          ? `<img class="tournament-video-launch__poster" src="${assetUrl(poster)}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling&&(this.nextElementSibling.hidden=false)" /><span class="tournament-video-launch__fallback" hidden></span>`
          : `<span class="tournament-video-launch__fallback"></span>`}
        <span class="tournament-video-launch__shade"></span>
        <span class="tournament-video-launch__play" aria-hidden="true">▶</span>
        ${title ? `<span class="tournament-video-launch__label">${title}</span>` : ""}
      </button>`;
  }

  function highlightsDuoHtml(m) {
    const { goals, full } = matchClips(m);
    if (!goals && !full) return "";
    const blocks = [];
    if (goals) {
      blocks.push(`
        <div class="tournament-video-block tournament-video-block--card tournament-video-block--goals">
          ${sectionHead("▶", "goals", t("tournament.goalsTitle"))}
          <p class="tournament-video-hint">${escapeHtml(t("tournament.goalsHint"))}</p>
          <div class="tournament-video-shell">
            <div class="tournament-video-stage">${videoLaunchBtn(goals, "goals")}</div>
          </div>
        </div>`);
    }
    if (full) {
      blocks.push(`
        <div class="tournament-video-block tournament-video-block--card tournament-video-block--full">
          ${sectionHead("▶", "video", t("tournament.highlightTitle"))}
          <p class="tournament-video-hint">${escapeHtml(t("tournament.fullHint"))}</p>
          <div class="tournament-video-shell">
            <div class="tournament-video-stage">${videoLaunchBtn(full, "full")}</div>
          </div>
        </div>`);
    }
    return `<div class="tournament-highlights-duo">${blocks.join("")}</div>`;
  }

  function notableClipsHtml(m) {
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
              <button type="button" class="tournament-clip-card tournament-video-launch match-replay-launch"
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

  function hasSummaryContent(m) {
    if (!m || m.status !== "ended") return false;
    if (m.summaryAr) return true;
    const { goals, full } = matchClips(m);
    if (goals || full) return true;
    return (m.clips || []).some((clip) => clip && clip.videoUrl && clip.kind !== "goals" && clip.kind !== "full");
  }

  function summaryBodyHtml(m) {
    const highlights = highlightsDuoHtml(m);
    const clips = notableClipsHtml(m);
    const novideo = !highlights && !clips
      ? `<p class="match-summary-novideo">${t("card.noHighlightVideo")}</p>`
      : "";
    const text = m.summaryAr ? `<p class="match-summary-text">${escapeHtml(m.summaryAr)}</p>` : "";
    return `${text}${clips}${highlights}${novideo}`;
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
    warmEmbed(embed);
    const modal = ensureVideoModal();
    const frame = modal.querySelector(".tournament-video-modal__frame");
    frame.innerHTML = `
      <iframe src="${embed}" title="${escapeHtml(t("card.highlightsTitle"))}" loading="eager"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope"
        allowfullscreen
        sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>`;
    modal.hidden = false;
    document.body.classList.add("tournament-video-modal-open");
  }

  function bindReplayLaunch(root) {
    if (!root) return;
    root.querySelectorAll(".match-replay-launch, .tournament-video-launch").forEach((btn) => {
      if (btn.dataset.kzReplayBound) return;
      btn.dataset.kzReplayBound = "1";
      const embedForBtn = () => btn.dataset.embed || btn.closest(".tournament-video-stage")?.dataset.embed;
      const warm = () => warmEmbed(embedForBtn());
      btn.addEventListener("pointerenter", warm, { once: true });
      btn.addEventListener("focus", warm, { once: true });
      btn.addEventListener("touchstart", warm, { once: true, passive: true });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openVideoModal(embedForBtn());
      });
    });
  }

  window.KZHighlights = {
    replayEmbedUrl,
    matchClips,
    hasSummaryContent,
    summaryBodyHtml,
    bindReplayLaunch,
  };
})();
