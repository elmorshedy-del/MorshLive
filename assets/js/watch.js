/* ============================================================================
 * watch.js — watch page: HLS player + server switching + sidebar.
 * Uses hls.js for browsers without native HLS, native playback on Safari/iOS.
 * Match data is loaded live via window.getMatches() (assets/data/today.json).
 * ==========================================================================*/
(function () {
  const t = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);
  // Player 2 VIP uses the same worldkoora embed as Player 1 for this channel.
  // The `serv` param is cosmetic — each embed has one real server.
  // Chrome needs a real referrer for Clappr/HLS inside the worldkoora iframe; Safari is lenient.
  const EMBED_REFERRER = "strict-origin-when-cross-origin";
  const embedUrlFor = (embed, i) =>
    (window.SITE_DATA && window.SITE_DATA.embedUrlFor)
      ? window.SITE_DATA.embedUrlFor(embed, i)
      : "";
  const servIndexFromParam = (embed, raw) =>
    (window.SITE_DATA && window.SITE_DATA.servIndexFromParam)
      ? window.SITE_DATA.servIndexFromParam(embed, raw)
      : 0;

  function vipEmbed() {
    const key = (match && match.embedKey) || (window.SITE_DATA && window.SITE_DATA.embedKeyFor(channel.id));
    const fromKey = window.SITE_DATA && window.SITE_DATA.embedForKey
      ? window.SITE_DATA.embedForKey(key)
      : null;
    const base = fromKey || channel.embed || { url: "/wk/albaplayer/vip1/", param: "serv", servStart: 1, servers: 1 };
    const extras = {};
    if (channel && channel.embed && channel.embed.defaultServer != null) {
      extras.defaultServer = channel.embed.defaultServer;
    }
    if (match && match.defaultServer != null) extras.defaultServer = match.defaultServer;
    return {
      ...base,
      channelId: (channel && channel.id) || base.channelId,
      ...extras,
    };
  }

  const { CHANNELS } = window.SITE_DATA;
  const params = new URLSearchParams(location.search);
  const teamLabel = (n) => (window.TeamNames ? window.TeamNames.localize(n) : n);

  let MATCHES = [];
  let channel = CHANNELS[0];
  let match = null;
  let isEmbed = false;
  let activePlayer = params.get("player") === "2" ? 2 : 1;

  const shell = document.getElementById("player-shell");
  let video = document.getElementById("video");
  let overlay = document.getElementById("overlay");
  const vipFrame = document.getElementById("vip-frame");
  let hls = null;
  let started = false;
  let savedShellMarkup = null;
  let vipLoaded = false;
  let vipLoadedUrl = "";

  /* HLS tuned for stable live playback on mobile (buffer over ultra-low latency). */
  function createHls() {
    return new window.Hls({
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 90,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      manifestLoadingTimeOut: 12000,
      manifestLoadingMaxRetry: 4,
      levelLoadingTimeOut: 12000,
    });
  }

  /* ---------------------------------------------- Player core */
  function loadStream(url) {
    video = document.getElementById("video");
    if (!video || !url) return;
    if (hls) { hls.destroy(); hls = null; }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.preload = "auto";
      video.src = url; // native HLS (Safari / iOS)
    } else if (window.Hls && window.Hls.isSupported()) {
      hls = createHls();
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url; // last-resort fallback
    }
  }

  function play() {
    video = document.getElementById("video");
    overlay = document.getElementById("overlay");
    if (!video || !overlay) return;
    started = true;
    overlay.classList.add("hidden");
    video.play().catch(() => {/* user gesture may still be required */});
  }

  /* ---------------------------------------------- Embed (iframe) mode */
  function embedUrl(serverIndex) {
    return embedUrlFor(channel.embed, serverIndex);
  }

  function currentEmbedServerIndex(embed) {
    return servIndexFromParam(embed, params.get("serv"));
  }

  function loadEmbed(serverIndex) {
    if (!savedShellMarkup) savedShellMarkup = shell.innerHTML;
    shell.innerHTML =
      `<iframe class="embed-frame" src="${embedUrl(serverIndex)}" ` +
      `allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen ` +
      `referrerpolicy="${EMBED_REFERRER}" scrolling="no" loading="eager" fetchpriority="high"></iframe>`;
  }

  function vipEmbedUrl(serverIndex) {
    return embedUrlFor(vipEmbed(), serverIndex);
  }

  function loadVipEmbed(serverIndex) {
    if (!vipFrame) return;
    const next = vipEmbedUrl(serverIndex);
    if (vipLoaded && vipLoadedUrl === next) return;
    vipFrame.src = next;
    vipLoaded = true;
    vipLoadedUrl = next;
  }

  function setActivePlayer(n) {
    activePlayer = n;
    isEmbed = !!channel.embed && n === 1;

    document.querySelectorAll(".player-switch-btn").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.player) === n);
    });
    document.getElementById("player-panel-1").classList.toggle("active", n === 1);
    document.getElementById("player-panel-2").classList.toggle("active", n === 2);

    const servers = document.getElementById("servers");
    const vipServers = document.getElementById("vip-servers");
    if (servers) servers.hidden = n !== 1;
    if (vipServers) vipServers.hidden = n !== 2;

    if (n === 1) {
      if (isEmbed) {
        loadEmbed(currentEmbedServerIndex(channel.embed));
      } else if (savedShellMarkup) {
        shell.innerHTML = savedShellMarkup;
        video = document.getElementById("video");
        overlay = document.getElementById("overlay");
        if (video && channel.stream) loadStream(channel.stream);
        if (overlay) overlay.addEventListener("click", play);
      }
      renderServers();
      ensureLiveFeed().catch(() => {});
    } else {
      loadVipEmbed(servIndexFromParam(vipEmbed(), params.get("serv")));
    }

    const next = new URL(location.href);
    params.set("player", n);
    next.searchParams.set("player", n);
    history.replaceState(null, "", next);
  }

  function initPlayerSwitch() {
    document.querySelectorAll(".player-switch-btn").forEach((btn) => {
      btn.addEventListener("click", () => setActivePlayer(Number(btn.dataset.player)));
    });
    setActivePlayer(activePlayer);
  }

  function renderVipServers() {
    const row = document.getElementById("vip-servers");
    if (!row) return;
    const activeServ = servIndexFromParam(vipEmbed(), params.get("serv"));

    const n = vipEmbed().servers || 1;
    row.innerHTML = Array.from({ length: n }, (_, i) =>
      `<button class="server-btn ${i === activeServ ? "active" : ""}" data-vip-srv="${i}" data-kind="reachable" data-url="${vipEmbedUrl(i)}" data-label="${t("watch.vipServer")} ${i + 1}"><span class="srv-label">${t("watch.vipServer")} ${i + 1}</span></button>`
    ).join("");

    row.querySelectorAll("[data-vip-srv]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const srv = Number(btn.dataset.vipSrv);
        row.querySelectorAll("[data-vip-srv]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        loadVipEmbed(srv);
        const next = new URL(location.href);
        const start = vipEmbed().servStart != null ? vipEmbed().servStart : 0;
        params.set("serv", start + srv);
        next.searchParams.set("serv", start + srv);
        history.replaceState(null, "", next);
      });
    });

    checkServers(row);
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

  /* ---------------------------------------------- Per-match structured data
   * Injects a SportsEvent JSON-LD for the resolved fixture so the watch page is
   * eligible for Google's event rich results. Re-runs on every fixture change;
   * skipped for ended matches (no longer an upcoming/live event). */
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
    const ms = parseKickoff(m.kickoffUtc);
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

  /* ---------------------------------------------- Head info */
  function matchIsCommentary() {
    return match && window.isRecentlyEndedMatch && window.isRecentlyEndedMatch(match);
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
      : `${t("watch.pressToPlayQ")} ${channel.quality}`;

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

    const overlayTitle = document.getElementById("overlay-title");
    const overlaySub = document.getElementById("overlay-sub");
    if (overlayTitle) overlayTitle.textContent = channel.name;
    if (overlaySub) {
      overlaySub.textContent = match
        ? commentary
          ? `${teamLabel(match.home)} ${t("watch.vs")} ${teamLabel(match.away)} · ${t("watch.commentary")}`
          : `${teamLabel(match.home)} ${t("watch.vs")} ${teamLabel(match.away)}`
        : `${t("watch.pressToPlayQ")} ${channel.quality}`;
    }

    injectMatchSchema(match);
  }

  /* ---------------------------------------------- Servers (quality mirrors) */
  function renderServers() {
    const row = document.getElementById("servers");

    if (isEmbed) {
      const n = channel.embed.servers || 1;
      const activeServ = currentEmbedServerIndex(channel.embed);
      row.innerHTML = Array.from({ length: n }, (_, i) =>
        `<button class="server-btn ${i === activeServ ? "active" : ""}" data-srv="${i}" data-kind="reachable" data-url="${embedUrl(i)}" data-label="${t("watch.server")} ${i + 1}"><span class="srv-label">${t("watch.server")} ${i + 1}</span></button>`
      ).join("");
      row.querySelectorAll(".server-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const srv = Number(btn.dataset.srv);
          row.querySelectorAll(".server-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          loadEmbed(srv);
          const next = new URL(location.href);
          const start = channel.embed.servStart != null ? channel.embed.servStart : 0;
          params.set("serv", start + srv);
          next.searchParams.set("serv", start + srv);
          history.replaceState(null, "", next);
        });
      });
      checkServers(row);
      return;
    }

    const servers = [
      { label: t("watch.serverHd"), url: channel.stream },
      { label: t("watch.serverSd"), url: channel.stream },
      { label: t("watch.serverBackup"), url: channel.stream },
    ];
    row.innerHTML = servers
      .map((s, i) => `<button class="server-btn ${i === 0 ? "active" : ""}" data-kind="hls" data-url="${s.url}" data-label="${s.label}"><span class="srv-label">${s.label}</span></button>`)
      .join("");
    row.querySelectorAll(".server-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        row.querySelectorAll(".server-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        loadStream(btn.dataset.url);
        if (started) video.play().catch(() => {});
      });
    });
    checkServers(row);
  }

  /* ---------------------------------------------- Live server detection */
  function checkServers(row, opts) {
    if (row && window.StreamCheck) {
      const embedRow = (row.id === "servers" && isEmbed) || row.id === "vip-servers";
      const options = embedRow ? { autoSelect: false, ...opts } : opts;
      window.StreamCheck.autoHighlight(row, options).catch(() => {});
    }
  }

  function recheckVisibleServers() {
    const servers = document.getElementById("servers");
    const vip = document.getElementById("vip-servers");
    if (servers && !servers.hidden) checkServers(servers, { autoSelect: false });
    if (vip && !vip.hidden) checkServers(vip, { autoSelect: false });
  }

  /* ---------------------------------------------- Sidebar (today's matches) */
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

  function resolveSelection() {
    const picked = window.resolveWatchSelection
      ? window.resolveWatchSelection(MATCHES, CHANNELS, params)
      : { channel: CHANNELS[0], match: null };
    channel = picked.channel;
    match = picked.match;
    isEmbed = !!(channel.embed && channel.embed.url) && activePlayer === 1;
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
      renderServers();
      renderVipServers();
      if (activePlayer === 2) loadVipEmbed(currentEmbedServerIndex(vipEmbed()));
      if (activePlayer === 1) {
        if (isEmbed) loadEmbed(currentEmbedServerIndex(channel.embed));
        else loadStream(channel.stream);
      }
    }
    scheduleAutoReload();
    ensureLiveFeed().catch(() => {});
  }

  /* ---------------------------------------------- Stream reload
   * The worldkoora source sometimes parks on a static frame while a match is
   * live. A fresh load of the active player recovers it, so we expose a manual
   * "reload" control AND start prewarming 30 minutes before each kickoff: from
   * then we poll until the channel actually has a live stream, then load the
   * worker's smoothest-ranked mirror and auto-play it — so the game is already
   * playing the smoothest feed by kick-off. */
  const RELOAD_LEAD_MS = 30 * 60 * 1000;
  const PREWARM_POLL_MS = 45 * 1000;
  const PREWARM_TAIL_MS = 20 * 60 * 1000; // keep trying until 20 min after kickoff
  let reloadTimer = null;
  let prewarmTimer = null;
  let prewarmStarted = false;

  function parseKickoff(ts) {
    if (ts == null || ts === "") return NaN;
    if (typeof ts === "number") return ts;            // already epoch millis
    const text = String(ts).trim();
    if (/^\d+$/.test(text)) return Number(text);      // epoch millis as a string
    const norm = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text) ? `${text}Z` : text;
    return Date.parse(norm);
  }

  function activeServerIndex() {
    const sel = activePlayer === 1
      ? document.querySelector("#servers .server-btn.active[data-srv]")
      : document.querySelector("#vip-servers .server-btn.active[data-vip-srv]");
    if (sel) return Number(sel.dataset.srv != null ? sel.dataset.srv : sel.dataset.vipSrv) || 0;
    return activePlayer === 2 ? currentEmbedServerIndex(vipEmbed()) : currentEmbedServerIndex(channel.embed);
  }

  function reloadActivePlayer() {
    if (activePlayer === 1) {
      if (isEmbed) {
        loadEmbed(activeServerIndex());
        ensureLiveFeed().catch(() => {});
      } else {
        // Reload the server the user actually has selected, not the default.
        const activeBtn = document.querySelector("#servers .server-btn.active");
        const url = (activeBtn && activeBtn.dataset.url) || channel.stream;
        if (url) { loadStream(url); if (started) play(); }
      }
    } else {
      vipLoaded = false; // bypass the same-URL guard so the iframe truly reloads
      loadVipEmbed(activeServerIndex());
    }
  }

  // Kickoff (ms) of the soonest match on the channel currently being watched (or
  // the selected match). Used to time the 30-minute prewarm.
  function nextRelevantKickoff() {
    const relevant = (MATCHES || []).filter((m) =>
      (channel && m.channelId && m.channelId === channel.id) ||
      (match && m.id === match.id)
    );
    return relevant
      .map((m) => parseKickoff(m.kickoffUtc))
      .filter((ms) => !isNaN(ms))
      .sort((a, b) => a - b)
      .find((ms) => ms > Date.now() - PREWARM_TAIL_MS);
  }

  // Does the channel currently being watched actually have a live stream ready?
  // The worker only serves a playable page when a mirror verifies live, so this
  // doubles as the "is the smoothest feed available yet" check.
  async function activeChannelHasStream() {
    try {
      const embed = activePlayer === 1 ? channel.embed : vipEmbed();
      const key = feedKeyOf(embed);
      const ch = (channel && channel.id) || "";
      const u = new URL(`/wk/albaplayer/${key}/`, location.origin);
      u.searchParams.set("ch", ch);
      const res = await fetch(u.toString(), { cache: "no-store" });
      if (!res.ok) return false;
      return htmlHasPlayableEmbed(await res.text());
    } catch (e) {
      return false;
    }
  }

  // From kickoff − 30 min, poll until the stream is live, then load + auto-play
  // the worker's smoothest-ranked mirror. Stops once playing (or after the tail).
  async function prewarmTick(kickoff) {
    if (prewarmTimer) { clearTimeout(prewarmTimer); prewarmTimer = null; }
    if (Date.now() > kickoff + PREWARM_TAIL_MS) return; // window passed
    if (prewarmStarted) return;
    const live = await activeChannelHasStream();
    if (live) {
      prewarmStarted = true;
      reloadActivePlayer();
      play();
      return;
    }
    prewarmTimer = setTimeout(() => prewarmTick(kickoff), PREWARM_POLL_MS);
  }

  // (Re)arm a single timer for the soonest "kickoff − 30 min" still in the future
  // — scoped to the channel being watched so an unrelated kickoff never interrupts
  // playback. At that point the prewarm poll takes over.
  function scheduleAutoReload() {
    if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; }
    prewarmStarted = false;
    const now = Date.now();
    const kickoff = nextRelevantKickoff();
    if (kickoff == null) return;
    const prewarmAt = kickoff - RELOAD_LEAD_MS;
    // Already inside the 30-min window (or just after kickoff): start prewarming now.
    if (prewarmAt <= now) {
      if (!prewarmTimer) prewarmTick(kickoff);
      return;
    }
    reloadTimer = setTimeout(() => {
      prewarmTick(kickoff);
      scheduleAutoReload();
    }, Math.min(prewarmAt - now, 0x7fffffff));
  }

  function initReloadButton() {
    const host = document.getElementById("player-switch");
    if (!host || host.querySelector(".js-stream-reload")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "player-switch-btn js-stream-reload";
    btn.setAttribute("aria-label", t("watch.reload"));
    btn.innerHTML =
      `<svg class="ico reload-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.3"/><polyline points="21 4 21 10 15 10"/></svg> ` +
      `<span data-i18n="watch.reload">${t("watch.reload")}</span>`;
    btn.addEventListener("click", () => {
      reloadActivePlayer();
      btn.classList.add("is-spinning");
      setTimeout(() => btn.classList.remove("is-spinning"), 700);
    });
    host.appendChild(btn);
  }

  /* ---------------------------------------------- Live-feed detection
   * Each channel now has its OWN stable dlhd feed, so the old 2-slot "swap to the
   * other vip" recovery is gone. We keep a cheap probe (used by the kickoff
   * prewarm) that asks the worker whether the channel's /dl/<id> page currently
   * resolves a playable stream. */
  function htmlHasPlayableEmbed(html) {
    return /AlbaPlayerControl\('([^']+)'/.test(html) ||
      /\/(?:wk\/stream\.m3u8|wk\/hls|dl\/hls)\?u=/.test(html) ||
      /\bdata-kz-src=/.test(html) ||
      /<iframe\b[^>]*\bsrc=["']https?:\/\/[^"']+/i.test(html) ||
      /<(?:source|video)\b[^>]*\bsrc=["']https?:\/\/[^"']+/i.test(html);
  }

  // The /dl/<id> player self-recovers via its internal hls.js retry loop, so
  // there's nothing to swap here anymore. Kept as a no-op for its callers.
  async function ensureLiveFeed() { return; }

  document.addEventListener("DOMContentLoaded", async () => {
    initNav();
    if (shell) savedShellMarkup = shell.innerHTML;
    resolveSelection();
    fillInfo();
    renderServers();
    renderVipServers();
    renderSidebar();
    if (activePlayer === 2) {
      loadVipEmbed(servIndexFromParam(vipEmbed(), params.get("serv")));
    }
    if (activePlayer === 1) {
      if (isEmbed) loadEmbed(currentEmbedServerIndex(channel.embed));
      else {
        loadStream(channel.stream);
        overlay.addEventListener("click", play);
      }
    }
    initPlayerSwitch();
    initReloadButton();
    ensureLiveFeed().catch(() => {});
    refreshMatches({ force: false }).catch((e) => console.warn("Initial match refresh failed:", e.message));
    setInterval(() => refreshMatches({ force: true }).catch((e) => console.warn("Match refresh failed:", e.message)), 90 * 1000);
    setInterval(recheckVisibleServers, 120 * 1000);
  });
})();
