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
  let matchesReady = false;
  let altStreamsSignature = "";
  let activeAltStreamKind = "kooraCity";
  let altStreamEntries = [];
  let lastStreamHealAt = 0;
  const ALT_STREAM_ORDER = ["kooraCity", "amineAlt", "sirTv", "ntv"];
  const STREAM_HEAL_MIN_MS = 8000;
  const STREAM_SOURCES = [
    { key: "vip1", servs: [1, 2, 3, 4] },
    { key: "vip2", servs: [1, 2, 3, 4] },
    { key: "amine", servs: [0, 1, 2, 3] },
    { key: "weshan", servs: [0, 1, 2, 3] },
  ];

  const MAIN_EMBED_URL = "https://tt.yalashot.online/2026/06/ch1.html?m=1";
  let activeEmbedKey = params.get("player") || null;
  const shell = document.getElementById("player-shell");
  let loadedUrl = "";
  let activeHls = null;

  async function fetchDlSources(chId) {
    const pageUrl = window.SITE_DATA.dlEmbedUrlFor ? window.SITE_DATA.dlEmbedUrlFor(chId) : "";
    if (!pageUrl) return [];
    try {
      const res = await fetch(pageUrl, { cache: "no-store" });
      if (!res.ok) return [];
      const html = await res.text();
      const listMatch = html.match(/sources=(\[[^\]]+\])/);
      if (listMatch) {
        try {
          const list = JSON.parse(listMatch[1]);
          if (Array.isArray(list) && list.length) return list.filter(Boolean);
        } catch {
          /* fall through */
        }
      }
      const one = html.match(/data-kz-src="([^"]+)"/);
      return one ? [one[1]] : [];
    } catch {
      return [];
    }
  }

  function destroyInlineHls() {
    if (!activeHls) return;
    try {
      activeHls.destroy();
    } catch {
      /* noop */
    }
    activeHls = null;
  }

  function bindUnmuteOverlay(video) {
    if (!shell || !video) return;
    let btn = shell.querySelector(".kz-unmute-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "kz-unmute-btn";
      btn.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg> <span>${t("watch.pressPlay")}</span>`;
      btn.addEventListener("click", () => {
        video.muted = false;
        const p = video.play && video.play();
        if (p && p.catch) p.catch(() => {});
        btn.hidden = true;
      });
      shell.appendChild(btn);
    }
    const show = () => {
      btn.hidden = false;
    };
    video.addEventListener("pause", () => {
      if (!video.ended) show();
    });
    video.addEventListener("playing", () => {
      if (!video.muted) btn.hidden = true;
    });
    if (video.paused || video.muted) show();
  }

  function mountInlineHls(sources) {
    destroyInlineHls();
    if (!shell || !sources.length) return false;
    const src = sources[0];
    shell.innerHTML = `<video class="kz-main-video" controls autoplay muted playsinline webkit-playsinline></video>`;
    const video = shell.querySelector(".kz-main-video");
    if (!video) return false;

    const onError = () => {
      loadedUrl = "";
      destroyInlineHls();
      loadIframePlayer(embedUrlFor(currentEmbed(), embedQuery(activeServ)));
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener("error", onError, { once: true });
    } else if (window.Hls && window.Hls.isSupported()) {
      activeHls = new window.Hls({ enableWorker: false });
      activeHls.on(window.Hls.Events.ERROR, (_e, data) => {
        if (data && data.fatal) onError();
      });
      activeHls.loadSource(src);
      activeHls.attachMedia(video);
    } else {
      video.src = src;
      video.addEventListener("error", onError, { once: true });
    }

    const playTry = video.play && video.play();
    if (playTry && playTry.catch) {
      playTry.catch(() => bindUnmuteOverlay(video));
    }
    bindUnmuteOverlay(video);
    loadedUrl = `inline-dl:${src}`;
    return true;
  }

  function loadIframePlayer(url, noSandbox) {
    if (!shell || !url) return;
    destroyInlineHls();
    if (loadedUrl === url) return;
    loadedUrl = url;
    const sandbox = noSandbox
      ? ""
      : 'sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" ';
    shell.innerHTML =
      `<iframe class="embed-frame" src="${url}" ` +
      `${sandbox}` +
      `allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen ` +
      `referrerpolicy="no-referrer-when-downgrade" scrolling="no" loading="eager" fetchpriority="high"></iframe>`;
  }

  async function loadPlayer() {
    if (!shell) return;
    loadIframePlayer(MAIN_EMBED_URL, true);
  }

  function reloadPlayer() {
    loadedUrl = "";
    destroyInlineHls();
    loadPlayer();
    reloadAltStreams();
  }

  function embedQuery(serv) {
    return {
      serv,
      matchId: match && match.id ? match.id : null,
      home: match && match.home ? match.home : null,
      away: match && match.away ? match.away : null,
    };
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

  function altStreamIframe(url, kind) {
    const noSandbox = kind === "ntv" || kind === "kooraCity";
    const sandbox = noSandbox
      ? ""
      : 'sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" ';
    return (
      `<iframe class="embed-frame alt-stream-frame" data-alt-kind="${escapeHtml(kind)}" src="${escapeHtml(url)}" ` +
      `${sandbox}` +
      `allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen ` +
      `referrerpolicy="${EMBED_REFERRER}" scrolling="no" loading="eager"></iframe>`
    );
  }

  function altStreamCssKind(kind) {
    if (kind === "kooraCity") return "kooracity";
    if (kind === "amineAlt") return "amine";
    if (kind === "sirTv") return "sirtv";
    if (kind === "ntv") return "ntv";
    return kind;
  }

  function buildAltStreamEntries(cfg) {
    if (!cfg || !window.SITE_DATA.altStreamUrl) return [];
    return ALT_STREAM_ORDER.filter((kind) => cfg[kind]).map((kind) => ({
      kind,
      def: cfg[kind],
      url: window.SITE_DATA.altStreamUrl(kind, match),
    }));
  }

  function altStreamTabHtml(entry, isActive) {
    const cssKind = altStreamCssKind(entry.kind);
    const isWorking = entry.kind === "kooraCity";
    const tagKey = isWorking ? "watch.altKooraWorkingTag" : "watch.altBackup";
    const tagClass = isWorking ? "alt-stream-tag alt-stream-tag--working" : "alt-stream-tag";
    const activeClass = isActive ? " is-active" : "";
    const workingClass = isWorking ? " alt-stream-tab--working" : "";
    return (
      `<button type="button" class="alt-stream-tab alt-stream-tab--${cssKind}${workingClass}${activeClass}" ` +
      `data-alt-kind="${escapeHtml(entry.kind)}" aria-pressed="${isActive ? "true" : "false"}">` +
      `<span class="alt-stream-name">${escapeHtml(t(entry.def.labelKey))}</span>` +
      `<span class="${tagClass}">${escapeHtml(t(tagKey))}</span>` +
      `</button>`
    );
  }

  function updateAltStreamTabState() {
    const card = document.getElementById("alt-streams");
    if (!card) return;
    card.querySelectorAll(".alt-stream-tab").forEach((btn) => {
      const active = btn.dataset.altKind === activeAltStreamKind;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const stage = card.querySelector(".alt-stream-stage");
    if (stage) {
      stage.className = `alt-stream-stage alt-stream-stage--${altStreamCssKind(activeAltStreamKind)}`;
    }
  }

  function loadActiveAltStreamIframe(entries) {
    const card = document.getElementById("alt-streams");
    if (!card) return;
    const stage = card.querySelector(".alt-stream-stage");
    const entry = entries.find((e) => e.kind === activeAltStreamKind);
    if (!stage || !entry) return;
    const current = stage.querySelector(".alt-stream-frame");
    if (current && current.dataset.altKind === activeAltStreamKind) {
      try {
        const cur = new URL(current.src);
        const next = new URL(entry.url, location.origin);
        if (cur.pathname === next.pathname && cur.search === next.search) return;
      } catch {
        /* reload on bad src */
      }
    }
    stage.innerHTML = altStreamIframe(entry.url, entry.kind);
  }

  function switchAltStream(kind) {
    if (!kind || kind === activeAltStreamKind) return;
    if (!altStreamEntries.some((e) => e.kind === kind)) return;
    activeAltStreamKind = kind;
    updateAltStreamTabState();
    loadActiveAltStreamIframe(altStreamEntries);
  }

  function bindAltStreamTabs(card) {
    if (card.dataset.altTabsBound === "1") return;
    card.dataset.altTabsBound = "1";
    card.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-alt-kind]");
      if (!btn || !btn.classList.contains("alt-stream-tab")) return;
      switchAltStream(btn.dataset.altKind);
    });
  }

  function renderAltStreams() {
    const card = document.getElementById("alt-streams");
    if (!card) return;
    const cfg = window.SITE_DATA.altStreamsForMatch
      ? window.SITE_DATA.altStreamsForMatch(match)
      : null;
    const entries = buildAltStreamEntries(cfg);
    if (!entries.length) {
      card.hidden = true;
      card.innerHTML = "";
      card.dataset.altTabsBound = "";
      altStreamsSignature = "";
      altStreamEntries = [];
      return;
    }

    altStreamEntries = entries;
    const signature = entries.map((e) => `${e.kind}:${e.url}`).join("|");
    if (!entries.some((e) => e.kind === activeAltStreamKind)) {
      activeAltStreamKind = entries[0].kind;
    }

    if (signature === altStreamsSignature && card.querySelector(".alt-stream-tabs")) {
      card.hidden = false;
      loadActiveAltStreamIframe(entries);
      updateAltStreamTabState();
      return;
    }
    altStreamsSignature = signature;

    const tabs = entries.map((entry) => altStreamTabHtml(entry, entry.kind === activeAltStreamKind)).join("");
    const showKooraAlert = entries.some((e) => e.kind === "kooraCity");

    card.hidden = false;
    card.innerHTML =
      `<div class="alt-streams-head">
        <h3 class="alt-streams-title">${escapeHtml(t("watch.altStreams"))}</h3>
        <p class="alt-streams-note">${escapeHtml(t("watch.altStreamsNote"))}</p>
      </div>` +
      (showKooraAlert
        ? `<div class="alt-streams-koora-alert" role="status">${escapeHtml(t("watch.altKooraLiveBanner"))}</div>`
        : "") +
      `<div class="alt-stream-tabs" role="tablist">${tabs}</div>
       <div class="alt-stream-stage alt-stream-stage--${altStreamCssKind(activeAltStreamKind)}"></div>`;

    bindAltStreamTabs(card);
    loadActiveAltStreamIframe(entries);
  }

  function showStreamHealToast() {
    let el = document.getElementById("stream-heal-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "stream-heal-toast";
      el.className = "stream-heal-toast";
      el.setAttribute("role", "status");
      const host = document.getElementById("player-panel-1") || document.getElementById("player-shell") || document.body;
      host.appendChild(el);
    }
    el.textContent = t("watch.streamHeal");
    el.hidden = false;
    clearTimeout(showStreamHealToast._hideTimer);
    showStreamHealToast._hideTimer = setTimeout(() => {
      el.hidden = true;
    }, 3500);
  }

  function bumpIframeHeal(frame) {
    if (!frame || !frame.src) return;
    try {
      const u = new URL(frame.src);
      u.searchParams.set("_heal", String(Date.now()));
      frame.src = u.toString();
    } catch {
      /* ignore bad src */
    }
  }

  function reloadAltStreamIframes(reason) {
    const frame = document.querySelector(".alt-stream-stage .alt-stream-frame");
    if (frame) bumpIframeHeal(frame);
    if (reason) console.info("Alt stream heal:", reason);
  }

  function bumpMainPlayer(reason) {
    const video = shell && shell.querySelector(".kz-main-video");
    if (video) {
      loadedUrl = "";
      destroyInlineHls();
      loadPlayer();
      if (reason) console.info("Main player heal:", reason);
      return;
    }
    const frame = shell && shell.querySelector(".embed-frame:not(.alt-stream-frame)");
    if (!frame) return;
    bumpIframeHeal(frame);
    loadedUrl = frame.src || loadedUrl;
    if (reason) console.info("Main player heal:", reason);
  }

  function healAllStreams(reason, { includeMain = false, force = false } = {}) {
    const now = Date.now();
    if (!force && reason !== "manual" && now - lastStreamHealAt < STREAM_HEAL_MIN_MS) return;
    lastStreamHealAt = now;
    showStreamHealToast();
    reloadAltStreamIframes(reason);
    if (includeMain || reason === "exhausted" || reason === "stall" || reason === "black") {
      bumpMainPlayer(reason);
    }
  }

  function initAltStreamHeal() {
    window.addEventListener("message", (ev) => {
      if (!ev.data || ev.data.type !== "kz-alt-reload") return;
      const reason = ev.data.reason || "stall";
      healAllStreams(reason, { includeMain: reason === "exhausted" || reason === "black" });
    });
  }

  function reloadAltStreams() {
    altStreamsSignature = "";
    const card = document.getElementById("alt-streams");
    if (card) card.dataset.altTabsBound = "";
    renderAltStreams();
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
    const H = window.KZHighlights;
    if (!H || !H.hasSummaryContent(m)) return "";
    return staticPanel(t("card.summary"), H.summaryBodyHtml(m));
  }

  function renderMatchSummary() {
    const slot = document.getElementById("match-summary-slot");
    if (slot) {
      slot.innerHTML = matchSummaryHtml(match);
      if (window.KZHighlights) window.KZHighlights.bindReplayLaunch(slot);
    }
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
      || JSON.stringify(before.goals) !== JSON.stringify(after.goals)
      || before.minute !== after.minute
      || before.score !== after.score
      || before.status !== after.status;
  }

  async function refreshMatchDetail() {
    if (!match || !window.MatchDetailAPI) return;
    if (match.status !== "live" && match.status !== "upcoming") return;
    const before = { lineups: match.lineups, stats: match.stats, minute: match.minute, score: match.score, status: match.status };
    try {
      const enriched = await window.MatchDetailAPI.enrichMatch(match, { force: true });
      if (!matchDetailChanged(before, enriched)) return;
      match = enriched;
      const idx = MATCHES.findIndex((m) => m.id === match.id);
      if (idx >= 0) MATCHES[idx] = enriched;
      fillInfo();
      renderSidebar();
      renderMatchDetail();
    } catch (e) {
      console.warn("Match detail refresh failed:", e.message);
    }
  }

  function liveStatusHtml(m, { liveKey = "watch.live" } = {}) {
    const minute = window.liveMinuteLabel ? window.liveMinuteLabel(m) : (m && m.status === "live" ? String(m.minute || "").trim() : "");
    const label = minute ? `${t(liveKey)} · ${minute}` : t(liveKey);
    return `<span class="status-pill status-live">${escapeHtml(label)}</span>`;
  }

  function fillInfo() {
    const live = !!(match && match.status === "live");
    const commentary = matchIsCommentary();
    document.getElementById("ch-name").textContent = channel.name;
    document.getElementById("ch-status").innerHTML = live
      ? liveStatusHtml(match)
      : commentary
        ? `<span class="status-pill status-ended">${escapeHtml(t("watch.endedCommentary"))}</span>`
        : `<span class="status-pill status-upcoming">${escapeHtml(t("watch.ready"))}</span>`;
    document.title = commentary
      ? `${teamLabel(match.home)} ${t("watch.vs")} ${teamLabel(match.away)} — ${t("watch.commentary")}`
      : `${channel.name} — ${t("watch.titleSuffix")}`;

    const sub = document.getElementById("now-sub");
    sub.textContent = match
      ? commentary
        ? `${teamLabel(match.home)} ${t("watch.vs")} ${teamLabel(match.away)} · ${match.score} · ${t("watch.commentary")}`
        : live && match.minute
          ? `${teamLabel(match.home)} ${t("watch.vs")} ${teamLabel(match.away)} · ${match.score} · ${match.minute}`
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

  function renderServerButton(src, serv, defaultKey) {
    const url = channelEmbedUrl(channel.id, src.key, serv);
    const isActive = (activeEmbedKey || defaultKey) === src.key && activeServ === serv;
    const isAlt = src.key === "weshan" || src.key === "amine";
    return `<button type="button" class="server-btn${isActive ? " active" : ""}${isAlt ? " server-btn--alt" : ""}"
      data-srv="${serv}" data-embed="${src.key}" data-kind="reachable" data-url="${escapeHtml(url)}"
      data-label="${sourceLabel(src.key)} ${t("watch.server")} ${serv}"
      aria-label="${sourceLabel(src.key)} ${t("watch.server")} ${serv}">
      <span class="srv-label">${serv}</span>
    </button>`;
  }

  function renderServerGroup(src, defaultKey) {
    return `<div class="server-group" data-group="${src.key}">
      <div class="server-group-label">${sourceLabel(src.key)}</div>
      <div class="server-group-row">${src.servs.map((serv) => renderServerButton(src, serv, defaultKey)).join("")}</div>
    </div>`;
  }

  function bindServerButtons(row) {
    row.querySelectorAll(".server-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeServ = Number(btn.dataset.srv) || 3;
        activeEmbedKey = btn.dataset.embed || "vip1";
        row.querySelectorAll(".server-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        row.dataset.embed = activeEmbedKey;
        row.dataset.serv = String(activeServ);
        const altFold = row.querySelector(".server-alt-details");
        if (altFold && (activeEmbedKey === "amine" || activeEmbedKey === "weshan")) altFold.open = true;
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
      const primary = STREAM_SOURCES.filter((src) => src.key === "vip1" || src.key === "vip2");
      const alt = STREAM_SOURCES.filter((src) => src.key === "amine" || src.key === "weshan");
      const activeKey = activeEmbedKey || defaultKey;
      const altOpen = activeKey === "amine" || activeKey === "weshan";
      row.innerHTML = `<div class="server-groups">
        ${primary.map((src) => renderServerGroup(src, defaultKey)).join("")}
        <details class="server-alt-details"${altOpen ? " open" : ""}>
          <summary class="server-alt-summary" data-i18n="watch.moreServers">${t("watch.moreServers")}</summary>
          <div class="server-alt-body">
            ${alt.map((src) => renderServerGroup(src, defaultKey)).join("")}
          </div>
        </details>
      </div>`;
      row.dataset.ch = channel.id;
      row.dataset.embed = activeEmbedKey || defaultKey || "";
      row.dataset.serv = String(activeServ);

      bindServerButtons(row);
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
          const altFold = row.querySelector(".server-alt-details");
          if (altFold && (activeEmbedKey === "amine" || activeEmbedKey === "weshan")) altFold.open = true;
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
      const minute = window.liveMinuteLabel ? window.liveMinuteLabel(m) : "";
      const statusText = m.status === "live" && minute ? `${sideLabel} · ${minute}` : sideLabel;
      return `<a class="side-match ${match && m.id === match.id ? "active" : ""}" href="watch.html?ch=${m.channelId || "live"}&match=${m.id}">
         <span class="side-status status-${m.status}">${escapeHtml(statusText)}</span>
         <span class="side-teams">${escapeHtml(m.home)} <i>×</i> ${escapeHtml(m.away)}</span>
         <span class="side-league">${escapeHtml(m.league || "")}</span>
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
      lastStreamHealAt = 0;
      reloadPlayer();
      showStreamHealToast();
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

  window.__kzOnMatchesUpdated = (matches) => {
    MATCHES = matches;
    if (!match) return;
    const updated = matches.find((m) => m.id === match.id);
    if (!updated) return;
    match = updated;
    renderMatchSummary();
  };

  async function refreshMatches({ force } = {}) {
    const previousChannelId = channel.id;
    const previousMatchId = match && match.id;
    const meta = await window.getMatches({ force: !!force });
    MATCHES = meta.matches;
    resolveSelection();
    fillInfo();
    renderAltStreams();
    const channelChanged = channel.id !== previousChannelId;
    const matchChanged = (match && match.id) !== previousMatchId;
    if (!matchesReady) {
      renderChannels();
      renderServers({ rebind: true });
      loadPlayer();
      matchesReady = true;
    } else {
      if (channelChanged) renderChannels();
      if (channelChanged || matchChanged) {
        renderServers({ rebind: true });
        reloadPlayer();
        if (matchChanged) {
          const pollSlot = document.getElementById("match-poll-slot");
          if (pollSlot) delete pollSlot.dataset.pollReady;
        }
      }
    }
    renderSidebar();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    initNav();
    initAltStreamHeal();
    initReloadButton();
    try {
      await refreshMatches({ force: false });
    } catch (e) {
      console.warn("Initial match refresh failed:", e.message);
      resolveSelection();
      fillInfo();
      renderChannels();
      renderServers();
      renderSidebar();
      loadPlayer();
      renderAltStreams();
    }
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
