/* ============================================================================
 * watch.js — single-player watch page. Worker picks the live mirror; no fake
 * server buttons or duplicate player tabs.
 * ==========================================================================*/
(function () {
  const t = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);
  const EMBED_REFERRER = "strict-origin-when-cross-origin";
  const embedUrlFor = (embed) =>
    (window.SITE_DATA && window.SITE_DATA.embedUrlFor)
      ? window.SITE_DATA.embedUrlFor(embed)
      : "";

  const { CHANNELS } = window.SITE_DATA;
  const params = new URLSearchParams(location.search);
  const teamLabel = (n) => (window.TeamNames ? window.TeamNames.localize(n) : n);

  let MATCHES = [];
  let channel = CHANNELS[0];
  let match = null;
  const shell = document.getElementById("player-shell");
  let loadedUrl = "";

  function currentEmbed() {
    return channel.embed || { url: "/wk/albaplayer/vip1/", channelId: channel.id };
  }

  function loadPlayer() {
    if (!shell) return;
    const url = embedUrlFor(currentEmbed());
    if (!url || loadedUrl === url) return;
    loadedUrl = url;
    shell.innerHTML =
      `<iframe class="embed-frame" src="${url}" ` +
      `allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen ` +
      `referrerpolicy="${EMBED_REFERRER}" scrolling="no" loading="eager" fetchpriority="high"></iframe>`;
  }

  function reloadPlayer() {
    loadedUrl = "";
    loadPlayer();
  }

  function timeZoneHtml(m) {
    const zones = window.getMatchTimeZones && m ? window.getMatchTimeZones(m) : [];
    if (!zones.length) return "—";
    return `
      <div class="time-zone-row watch-times">
        ${zones.map((z) => `
          <div class="time-chip time-chip-${z.key}">
            <span>${z.label}</span>
            <b>${z.value}</b>
          </div>`).join("")}
      </div>`;
  }

  function commentatorHtml(m) {
    if (m && m.commentators && m.commentators.length) {
      return `<div class="commentator-list">${m.commentators
        .map((c) => `<span class="commentator-item"><b>${c.name}</b>${c.channel ? `<i>${c.channel}</i>` : ""}</span>`)
        .join("")}</div>`;
    }
    return (m && m.commentator) || "—";
  }

  function injectMatchSchema(m) {
    const old = document.getElementById("event-schema");
    if (old) old.remove();
    if (!m || !m.home || !m.away || m.status === "ended") return;
    const data = {
      "@context": "https://schema.org",
      "@type": "SportsEvent",
      name: `${m.home} vs ${m.away}`,
      sport: "Soccer",
      eventStatus: "https://schema.org/EventScheduled",
      competitor: [
        { "@type": "SportsTeam", name: m.home },
        { "@type": "SportsTeam", name: m.away },
      ],
    };
    const ms = Date.parse(String(m.kickoffUtc || "").replace(/Z?$/, "Z"));
    if (!isNaN(ms)) data.startDate = new Date(ms).toISOString();
    if (m.league) data.description = m.league;
    data.location = m.venue
      ? { "@type": "Place", name: m.venue }
      : { "@type": "VirtualLocation", url: "https://korazero.com/watch" };
    const s = document.createElement("script");
    s.type = "application/ld+json";
    s.id = "event-schema";
    s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
  }

  function matchIsCommentary() {
    return match && window.isRecentlyEndedMatch && window.isRecentlyEndedMatch(match);
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function staticPanel(label, bodyHtml) {
    if (!bodyHtml) return "";
    return `
      <div class="match-panel match-panel--static">
        <div class="match-panel-toggle match-panel-toggle--static">${label}</div>
        <div class="match-panel-body">${bodyHtml}</div>
      </div>`;
  }

  /* ملخص المباراة (match summary) — Arabic recap + highlight clip when the
     current match has ended, shown next to the commentary replay. */
  function matchSummaryHtml(m) {
    if (!m || m.status !== "ended" || (!m.summaryAr && !m.highlight)) return "";
    const videoBlock = m.highlight && m.highlight.videoUrl
      ? `<div class="match-highlight-video">
           <iframe src="${m.highlight.videoUrl}" title="${escapeHtml(t("card.highlightsTitle"))}" loading="lazy"
             allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen
             sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe>
         </div>`
      : `<p class="match-summary-novideo">${t("card.noHighlightVideo")}</p>`;
    const body = `${m.summaryAr ? `<p class="match-summary-text">${escapeHtml(m.summaryAr)}</p>` : ""}${videoBlock}`;
    return staticPanel(t("card.summary"), body);
  }

  function renderMatchSummary() {
    const slot = document.getElementById("match-summary-slot");
    if (slot) slot.innerHTML = matchSummaryHtml(match);
  }

  /* التشكيلة الرسمية + إحصائيات المباراة — below the stream, as requested:
     lineups as soon as ESPN confirms them (pre-match through full time),
     advanced stats once the match is live. */
  function renderMatchDetail() {
    const slot = document.getElementById("match-detail-slot");
    if (!slot) return;
    const lineupsHtml = match && match.lineups && window.buildLineupsHtml
      ? staticPanel(t("card.lineups"), window.buildLineupsHtml(match))
      : "";
    const statsHtml = match && match.stats && (match.status === "live" || match.status === "ended") && window.buildStatsHtml
      ? staticPanel(t("card.stats"), window.buildStatsHtml(match))
      : "";
    slot.innerHTML = lineupsHtml + statsHtml;
    if (window.activateStatBars) window.activateStatBars(slot);
  }

  function fillInfo() {
    const live = !!(match && match.status === "live");
    const commentary = matchIsCommentary();
    document.getElementById("ch-name").textContent = channel.name;
    document.getElementById("ch-status").innerHTML = live
      ? `<span class="status-pill status-live">${t("watch.live")}</span>`
      : commentary
        ? `<span class="status-pill status-ended">${t("watch.endedCommentary")}</span>`
        : `<span class="status-pill status-upcoming">${t("watch.ready")}</span>`;
    document.title = commentary
      ? `${teamLabel(match.home)} ${t("watch.vs")} ${teamLabel(match.away)} — ${t("watch.commentary")}`
      : `${channel.name} — ${t("watch.titleSuffix")}`;

    const sub = document.getElementById("now-sub");
    sub.textContent = match
      ? commentary
        ? `${teamLabel(match.home)} ${t("watch.vs")} ${teamLabel(match.away)} · ${match.score} · ${t("watch.commentary")}`
        : `${teamLabel(match.home)} ${t("watch.vs")} ${teamLabel(match.away)} · ${match.league}`
      : channel.quality;

    document.getElementById("info-quality").textContent = channel.quality;
    document.getElementById("info-group").textContent = channel.group;
    const infoRoute = document.getElementById("info-route");
    if (infoRoute) {
      const key = window.SITE_DATA && window.SITE_DATA.embedKeyFor
        ? window.SITE_DATA.embedKeyFor(channel.id)
        : "";
      infoRoute.textContent = key
        ? `${key} ← ${match && match.channel ? match.channel : channel.name}`
        : "—";
    }
    document.getElementById("info-commentator").innerHTML = commentatorHtml(match);
    document.getElementById("info-league").textContent = (match && match.league) || "—";
    const infoTimes = document.getElementById("info-times");
    if (infoTimes) infoTimes.innerHTML = timeZoneHtml(match);
    renderMatchDetail();
    renderMatchSummary();
    injectMatchSchema(match);
  }

  function renderSidebar() {
    const panel = document.getElementById("side-channels");
    if (!panel) return;
    const order = { live: 0, upcoming: 1, ended: 2 };
    const list = MATCHES.slice().sort((a, b) => (order[a.status] - order[b.status])).slice(0, 14);
    if (!list.length) {
      panel.innerHTML = `<div class="side-empty">${t("watch.noMatches")}</div>`;
      return;
    }
    const label = {
      live: t("side.live"),
      upcoming: t("side.upcoming"),
      ended: t("side.ended"),
    };
    panel.innerHTML = list.map((m) => {
      const sideLabel = (window.isRecentlyEndedMatch && window.isRecentlyEndedMatch(m))
        ? t("side.commentary")
        : (label[m.status] || m.status);
      return `<a class="side-match ${match && m.id === match.id ? "active" : ""}" href="watch.html?ch=${m.channelId || "live"}&match=${m.id}">
         <span class="side-status status-${m.status}">${sideLabel}</span>
         <span class="side-teams">${m.home} <i>×</i> ${m.away}</span>
         <span class="side-league">${m.league || ""}</span>
       </a>`;
    }).join("");
  }

  function initNav() {
    const toggle = document.querySelector(".nav-toggle");
    const links = document.querySelector(".nav-links");
    if (toggle && links) toggle.addEventListener("click", () => links.classList.toggle("open"));
  }

  function initReloadButton() {
    const host = document.getElementById("player-toolbar");
    if (!host || host.querySelector(".js-stream-reload")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "player-reload-btn js-stream-reload";
    btn.setAttribute("aria-label", t("watch.reload"));
    btn.innerHTML =
      `<svg class="ico reload-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.3"/><polyline points="21 4 21 10 15 10"/></svg> ` +
      `<span data-i18n="watch.reload">${t("watch.reload")}</span>`;
    btn.addEventListener("click", () => {
      reloadPlayer();
      btn.classList.add("is-spinning");
      setTimeout(() => btn.classList.remove("is-spinning"), 700);
    });
    host.appendChild(btn);
  }

  function resolveSelection() {
    const picked = window.resolveWatchSelection
      ? window.resolveWatchSelection(MATCHES, CHANNELS, params)
      : { channel: CHANNELS[0], match: null };
    channel = picked.channel;
    match = picked.match;
  }

  async function refreshMatches({ force } = {}) {
    const previousChannelId = channel.id;
    const previousMatchId = match && match.id;
    const meta = await window.getMatches({ force: !!force });
    MATCHES = meta.matches;
    resolveSelection();
    fillInfo();
    renderSidebar();
    const matchChanged = (match && match.id) !== previousMatchId;
    if (channel.id !== previousChannelId || matchChanged) {
      reloadPlayer();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initNav();
    resolveSelection();
    fillInfo();
    renderSidebar();
    loadPlayer();
    initReloadButton();
    refreshMatches({ force: false }).catch((e) => console.warn("Initial match refresh failed:", e.message));
    setInterval(() => refreshMatches({ force: true }).catch((e) => console.warn("Match refresh failed:", e.message)), 90 * 1000);
  });
})();
