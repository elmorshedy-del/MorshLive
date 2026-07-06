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
  const STREAM_SOURCES = [
    { key: "vip1", servs: [1, 2, 3, 4] },
    { key: "vip2", servs: [1, 2, 3, 4] },
    { key: "amine", servs: [0, 1, 2, 3] },
    { key: "weshan", servs: [0, 1, 2, 3] },
  ];

  let activeServ = params.has("serv") ? Number(params.get("serv")) : 3;
  let activeEmbedKey = params.get("player") || null;
  const shell = document.getElementById("player-shell");
  let loadedUrl = "";

  function embedQuery(serv) {
    return { serv, matchId: match && match.id ? match.id : null };
  }

  function channelEmbedUrl(chId, embedKey, serv) {
    const key = embedKey || (window.SITE_DATA && window.SITE_DATA.embedKeyFor(chId)) || "vip1";
    const embed = { ...(window.SITE_DATA.embedForKey(key)), channelId: chId };
    const q = typeof serv === "object" ? serv : embedQuery(serv);
    if (q.serv == null) q.serv = serv;
    return embedUrlFor(embed, q);
  }

  function currentEmbed() {
    const key = activeEmbedKey || (match && match.embedKey) || (window.SITE_DATA && window.SITE_DATA.embedKeyFor(channel.id)) || "vip1";
    return { ...(window.SITE_DATA.embedForKey(key)), channelId: channel.id };
  }

  function loadPlayer() {
    if (!shell) return;
    const url = embedUrlFor(currentEmbed(), embedQuery(activeServ));
    if (!url || loadedUrl === url) return;
    loadedUrl = url;
    shell.innerHTML =
      `<iframe class="embed-frame" src="${url}" ` +
      `sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" ` +
      `allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen ` +
      `referrerpolicy="${EMBED_REFERRER}" scrolling="no" loading="eager" fetchpriority="high"></iframe>`;
  }

  function reloadPlayer() {
    loadedUrl = "";
    loadPlayer();
    refreshStreamGeoNotice().catch(() => {});
  }

  async function refreshStreamGeoNotice() {
    const slot = document.getElementById("stream-geo-notice");
    if (!slot || !channel || !channel.id) return;
    const embedKey = activeEmbedKey || (window.SITE_DATA && window.SITE_DATA.embedKeyFor(channel.id)) || "vip1";
    const q = new URLSearchParams({ ch: channel.id, slot: embedKey, serv: String(activeServ) });
    if (match && match.id) q.set("match", match.id);
    try {
      const res = await fetch(`/api/stream-diagnose?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const route = document.getElementById("info-route");
      if (data.proxyPlayable) {
        slot.hidden = true;
        slot.innerHTML = "";
        if (route) route.textContent = "proxy";
        return;
      }
      if (!data.geoSuspect && data.verdict !== "mixed_geo_and_dead") {
        slot.hidden = true;
        slot.innerHTML = "";
        return;
      }
      const egress = data.workerEgress || {};
      const where = egress.country ? `${egress.country}${egress.colo ? ` (${egress.colo})` : ""}` : "Cloudflare edge";
      const links = (data.directFallbacks || [])
        .map((f) => `<a href="${f.url}" target="_blank" rel="noopener noreferrer">${f.label}</a>`)
        .join("");
      slot.innerHTML =
        `<div><b>Geo-block on proxy</b> — Worker edge ${where} cannot play HLS variants (403/451). ` +
        `Direct upstream may still work in your region; player switches to direct mode when needed.</div>` +
        (links ? `<div class="stream-geo-notice__links">${links}</div>` : "");
      slot.hidden = false;
      if (route) route.textContent = data.directMayWork ? "direct · geo" : data.verdict;
    } catch {
      /* optional */
    }
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
    const goalsBody = match && window.buildGoalsHtml ? window.buildGoalsHtml(match) : "";
    const goalsHtml = goalsBody ? staticPanel(t("card.goals"), goalsBody) : "";
    const lineupsHtml = match && match.lineups && window.buildLineupsHtml
      ? staticPanel(t("card.lineups"), window.buildLineupsHtml(match))
      : "";
    const hasStats = match && match.stats && (match.status === "live" || match.status === "ended") && window.buildStatsHtml;
    const statsNoticeSlot = hasStats ? '<div id="stats-notice-slot" class="match-notice-slot"></div>' : "";
    const statsHtml = hasStats
      ? statsNoticeSlot + staticPanel(t("card.stats"), window.buildStatsHtml(match))
      : "";
    slot.innerHTML = goalsHtml + lineupsHtml + statsHtml;
    if (window.activateStatBars) window.activateStatBars(slot);
    if (hasStats && window.MatchNotice) {
      const noticeSlot = document.getElementById("stats-notice-slot");
      window.MatchNotice.showStatsBeta(noticeSlot).catch(() => {
        if (noticeSlot) noticeSlot.innerHTML = "";
      });
    }
  }

  function matchDetailChanged(before, after) {
    if (!before || !after) return true;
    return JSON.stringify(before.lineups) !== JSON.stringify(after.lineups)
      || JSON.stringify(before.stats) !== JSON.stringify(after.stats)
      || JSON.stringify(before.goals) !== JSON.stringify(after.goals);
  }

  async function refreshMatchDetail() {
    if (!match || !window.MatchDetailAPI) return;
    if (match.status !== "live" && match.status !== "upcoming") return;
    const before = { lineups: match.lineups, stats: match.stats };
    try {
      const enriched = await window.MatchDetailAPI.enrichMatch(match, { force: true });
      if (!matchDetailChanged(before, enriched)) return;
      match = enriched;
      const idx = MATCHES.findIndex((m) => m.id === match.id);
      if (idx >= 0) MATCHES[idx] = enriched;
      renderMatchDetail();
    } catch (e) {
      console.warn("Match detail refresh failed:", e.message);
    }
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
    renderMatchNotice();
    renderMatchPoll();
  }

  function renderMatchPoll() {
    const slot = document.getElementById("match-poll-slot");
    if (!slot || !window.MatchPoll) return;
    if (!match) {
      slot.innerHTML = "";
      delete slot.dataset.pollReady;
      return;
    }
    window.MatchPoll.show(slot, match).catch(() => {
      slot.innerHTML = "";
    });
  }

  function renderMatchNotice() {
    const slot = document.getElementById("match-notice-slot");
    if (!slot || !window.MatchNotice) return;
    if (!match) {
      slot.innerHTML = "";
      slot.hidden = true;
      return;
    }
    window.MatchNotice.showForMatch(slot, match).then((shown) => {
      slot.hidden = !shown;
    }).catch(() => {
      slot.innerHTML = "";
      slot.hidden = true;
    });
  }

  function renderChannels() {
    const row = document.getElementById("channel-row");
    if (!row) return;
    const matchCh = match && match.channelId;
    row.innerHTML = CHANNELS.map((ch) => {
      const isActive = ch.id === channel.id;
      const isMatch = ch.id === matchCh;
      return `<button type="button" class="channel-btn${isActive ? " active" : ""}${isMatch ? " channel-btn--match" : ""}"
        data-ch="${escapeHtml(ch.id)}" data-url="${escapeHtml(channelEmbedUrl(ch.id, null, activeServ))}"
        data-label="${escapeHtml(ch.name)}" data-kind="reachable">
        <span class="channel-btn-name">${escapeHtml(ch.name)}</span>
        ${isMatch ? `<span class="channel-btn-tag">${t("watch.matchChannel")}</span>` : ""}
      </button>`;
    }).join("");

    row.querySelectorAll(".channel-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const chId = btn.dataset.ch;
        const next = new URL(location.href);
        next.searchParams.set("ch", chId);
        if (match && match.id) next.searchParams.set("match", match.id);
        next.searchParams.set("serv", String(activeServ));
        location.href = next.toString();
      });
    });

    if (window.StreamCheck) window.StreamCheck.autoHighlight(row, { autoSelect: false }).catch(() => {});
  }

  function sourceLabel(key) {
    if (key === "weshan") return t("watch.weshan");
    if (key === "amine") return t("watch.amine");
    return key.toUpperCase();
  }

  function renderServers({ rebind } = {}) {
    const row = document.getElementById("servers");
    if (!row) return;
    const defaultKey = (match && match.embedKey) || window.SITE_DATA.embedKeyFor(channel.id);
    const needsRebuild = rebind !== false && (
      !row.querySelector(".server-btn") ||
      row.dataset.ch !== channel.id ||
      row.dataset.embed !== (activeEmbedKey || defaultKey || "") ||
      row.dataset.serv !== String(activeServ)
    );

    if (needsRebuild) {
      const buttons = [];
      for (const src of STREAM_SOURCES) {
        for (const serv of src.servs) {
          const url = channelEmbedUrl(channel.id, src.key, serv);
          const isActive = (activeEmbedKey || defaultKey) === src.key && activeServ === serv;
          buttons.push(`<button type="button" class="server-btn${isActive ? " active" : ""}${src.key === "weshan" || src.key === "amine" ? " server-btn--alt" : ""}"
            data-srv="${serv}" data-embed="${src.key}" data-kind="reachable" data-url="${escapeHtml(url)}"
            data-label="${sourceLabel(src.key)} ${t("watch.server")} ${serv}">
            <span class="srv-label">${sourceLabel(src.key)} · ${t("watch.server")} ${serv}</span>
          </button>`);
        }
      }
      row.innerHTML = buttons.join("");
      row.dataset.ch = channel.id;
      row.dataset.embed = activeEmbedKey || defaultKey || "";
      row.dataset.serv = String(activeServ);

      row.querySelectorAll(".server-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeServ = Number(btn.dataset.srv) || 3;
          activeEmbedKey = btn.dataset.embed || "vip1";
          row.querySelectorAll(".server-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          row.dataset.embed = activeEmbedKey;
          row.dataset.serv = String(activeServ);
          const next = new URL(location.href);
          next.searchParams.set("ch", channel.id);
          next.searchParams.set("serv", String(activeServ));
          next.searchParams.set("player", activeEmbedKey);
          if (match && match.id) next.searchParams.set("match", match.id);
          history.replaceState(null, "", next.toString());
          reloadPlayer();
        });
      });
    }

    if (window.StreamCheck) {
      window.StreamCheck.autoHighlight(row, { autoSelect: true }).then((res) => {
        if (!res || !res.firstOk || res.firstOk.classList.contains("srv-down")) return;
        const active = row.querySelector(".server-btn.active");
        // Keep the user's working pick — only auto-switch when nothing is active or it died.
        if (active && !active.classList.contains("srv-down")) return;
        const srv = Number(res.firstOk.dataset.srv);
        const emb = res.firstOk.dataset.embed;
        if (emb && !Number.isNaN(srv) && (srv !== activeServ || emb !== activeEmbedKey)) {
          activeServ = srv;
          activeEmbedKey = emb;
          row.dataset.embed = activeEmbedKey;
          row.dataset.serv = String(activeServ);
          row.querySelectorAll(".server-btn").forEach((b) => b.classList.remove("active"));
          res.firstOk.classList.add("active");
          const next = new URL(location.href);
          next.searchParams.set("ch", channel.id);
          next.searchParams.set("serv", String(activeServ));
          next.searchParams.set("player", activeEmbedKey);
          if (match && match.id) next.searchParams.set("match", match.id);
          history.replaceState(null, "", next.toString());
          reloadPlayer();
        }
      }).catch(() => {});
    }
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
      : { channel: CHANNELS[0], match: null, embedKey: null };
    channel = picked.channel;
    match = picked.match;
    activeEmbedKey = params.get("player") || picked.embedKey || (match && match.embedKey) || null;
    if (params.has("serv")) activeServ = Number(params.get("serv"));
    else if (match && match.streamServ != null) activeServ = Number(match.streamServ);
    if (Number.isNaN(activeServ)) activeServ = 3;
  }

  async function refreshMatches({ force } = {}) {
    const previousChannelId = channel.id;
    const previousMatchId = match && match.id;
    const meta = await window.getMatches({ force: !!force });
    MATCHES = meta.matches;
    resolveSelection();
    fillInfo();
    const channelChanged = channel.id !== previousChannelId;
    const matchChanged = (match && match.id) !== previousMatchId;
    if (channelChanged) renderChannels();
    if (channelChanged || matchChanged) {
      renderServers({ rebind: true });
      reloadPlayer();
      if (matchChanged) {
        const pollSlot = document.getElementById("match-poll-slot");
        if (pollSlot) delete pollSlot.dataset.pollReady;
      }
    }
    renderSidebar();
  }

  document.addEventListener("DOMContentLoaded", () => {
    initNav();
    resolveSelection();
    fillInfo();
    renderChannels();
    renderServers();
    renderSidebar();
    loadPlayer();
    refreshStreamGeoNotice().catch(() => {});
    initReloadButton();
    refreshMatches({ force: false }).catch((e) => console.warn("Initial match refresh failed:", e.message));
    setInterval(() => refreshMatches({ force: true }).catch((e) => console.warn("Match refresh failed:", e.message)), 90 * 1000);
    setInterval(() => refreshMatchDetail().catch((e) => console.warn("Detail refresh failed:", e.message)), 60 * 1000);
    setInterval(() => {
      const chRow = document.getElementById("channel-row");
      const srvRow = document.getElementById("servers");
      if (window.StreamCheck) {
        if (chRow) window.StreamCheck.autoHighlight(chRow, { autoSelect: false }).catch(() => {});
        if (srvRow) window.StreamCheck.autoHighlight(srvRow, { autoSelect: false }).catch(() => {});
      }
    }, 120 * 1000);
  });
})();
