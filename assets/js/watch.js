/* ============================================================================
 * watch.js — single-player watch page. Worker picks the live mirror; no fake
 * server buttons or duplicate player tabs.
 * ==========================================================================*/
(function () {
  const t = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);
  const EMBED_REFERRER = "no-referrer";
  const embedUrlFor = (embed) =>
    (window.SITE_DATA && window.SITE_DATA.embedUrlFor)
      ? window.SITE_DATA.embedUrlFor(embed)
      : "";

  const { CHANNELS } = window.SITE_DATA;
  const params = new URLSearchParams(location.search);
  const xtreamMode = params.get("source") === "xtream";
  const xtreamDirect = params.get("direct") === "1";
  const xtreamPortalId = params.get("portal") || "";
  const rawXtreamStreamId = String(params.get("stream") || "");
  const xtreamStreamId = xtreamPortalId === "direct"
    ? rawXtreamStreamId.replace(/[^a-z0-9_-]/gi, "")
    : rawXtreamStreamId.replace(/[^0-9]/g, "");
  const teamLabel = (n) => (window.TeamNames ? window.TeamNames.localize(n) : n);

  let MATCHES = [];
  let channel = CHANNELS[0];
  let match = null;
  let matchesReady = false;
  let altStreamsSignature = "";
  let activeAltStreamKind = "daddyLive";
  let altStreamEntries = [];
  let lastStreamHealAt = 0;
  const ALT_STREAM_ORDER = ["daddyLive", "kooraCity", "ntv", "sirTv"];
  const STREAM_HEAL_MIN_MS = 8000;
  const FRAME_LOAD_TIMEOUT_MS = 14000;
  const FRAME_SECOND_RETRY_MS = 28000;
  const FRAME_WATCHDOGS = new WeakMap();

  // Pinned main-player override + manual click-to-play cards for a specific
  // match. `mainPlayer` auto-loads in the primary player shell on page load
  // (its `fallback` is a same-content mirror on a different CDN, tried once
  // on error — not a switch to a different source/embed). `cards` are
  // separate, secondary options: no auto-select, no auto-switching between
  // them — the user picks one explicitly.
  const MANUAL_MIRROR_MATCHES = [
    {
      teams: ["spain", "belgium"],
      // Fabor disabled embeds during World Cup 2026. Do not pin it as main;
      // let the normal proxied player and backup panel handle playback.
      mainPlayer: null,
      cards: [
        {
          id: "mirror-b",
          label: "Mirror B",
          url: "https://3.simokora.com/my-hls/0wo68p0w54v/master.m3u8",
          fallback: "https://2.simokora.com/my-hls/0wo68p0w54v/master.m3u8",
        },
        {
          id: "mirror-c",
          label: "Mirror C",
          url: "https://3.simokora.com/my-hls/uktmlo48gga/master.m3u8",
        },
        {
          id: "mirror-d",
          label: "Mirror D",
          url: "https://3.simokora.com/my-hls/4v561xgucp9/master.m3u8",
          fallback: "https://2.simokora.com/my-hls/4v561xgucp9/master.m3u8",
        },
        {
          id: "mirror-ir",
          label: "Iran CDN",
          url: "https://edge22.776740.ir.cdn.ir/hls2/sport.m3u8",
        },
        {
          id: "mirror-adab",
          label: "AdabMedia",
          url: "https://cp11.adabmedia.com/hls2/sport.m3u8",
        },
      ],
    },
  ];

  function normalizeTeamName(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function manualMirrorEntryForMatch(m) {
    if (!m || !m.home || !m.away) return null;
    const a = normalizeTeamName(m.home);
    const b = normalizeTeamName(m.away);
    return (
      MANUAL_MIRROR_MATCHES.find((e) => {
        const [x, y] = e.teams;
        return (a === x && b === y) || (a === y && b === x);
      }) || null
    );
  }

  function mainPlayerOverrideForMatch(m) {
    const entry = manualMirrorEntryForMatch(m);
    return entry ? entry.mainPlayer || null : null;
  }

  function manualMirrorsForMatch(m) {
    const entry = manualMirrorEntryForMatch(m);
    return entry ? entry.cards || null : null;
  }

  let activeServ = params.has("serv") ? Number(params.get("serv")) : 3;
  let activeEmbedKey = params.get("player") || null;
  const shell = document.getElementById("player-shell");
  let loadedUrl = "";
  let activeHls = null;
  let activeMpegTs = null;
  let activeXtreamChannel = null;
  let xtreamRecoveryCount = 0;

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
    if (activeHls) {
      try {
        activeHls.destroy();
      } catch {
        /* noop */
      }
      activeHls = null;
    }
    if (activeMpegTs) {
      try {
        activeMpegTs.pause();
        activeMpegTs.unload();
        activeMpegTs.detachMediaElement();
        activeMpegTs.destroy();
      } catch {
        /* noop */
      }
      activeMpegTs = null;
    }
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
      const embed = currentEmbed();
      loadIframePlayer(embedUrlFor(embed, embedQuery(activeServ)), !!embed.noSandbox);
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

  async function fetchXtreamChannel() {
    if (!xtreamPortalId || !xtreamStreamId) throw new Error("بيانات قناة IPTV غير مكتملة");
    const isConfiguredDirect = xtreamPortalId === "direct";
    const query = new URLSearchParams(
      isConfiguredDirect
        ? { id: xtreamStreamId }
        : { portal: xtreamPortalId, stream: xtreamStreamId, limit: "1" },
    );
    if (xtreamDirect && !isConfiguredDirect) query.set("direct", "1");
    const endpoint = isConfiguredDirect ? "/api/xtream/direct-streams" : "/api/xtream/live";
    const response = await fetch(`${endpoint}?${query}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
    const selected = isConfiguredDirect
      ? (data.streams || [])[0]
      : (data.portals || []).flatMap((block) => block.streams || [])[0];
    if (!selected) throw new Error("قناة IPTV غير متاحة حالياً");
    activeXtreamChannel = selected;
    channel = {
      id: `xtream-${selected.portalId}-${selected.streamId}`,
      name: selected.name || params.get("name") || "IPTV",
      quality: "Live",
      group: selected.categoryName || "IPTV",
    };
    match = null;
    return selected;
  }

  function showXtreamError(message) {
    destroyInlineHls();
    if (!shell) return;
    shell.innerHTML = `<div class="manual-mirror-error">${escapeHtml(message || "تعذر تشغيل قناة IPTV")}</div>`;
  }

  function mountXtreamPlayer(selected) {
    destroyInlineHls();
    if (!shell || !selected || !selected.playbackUrl) return;
    const hlsUrl = xtreamDirect && selected.directPlaybackUrl ? selected.directPlaybackUrl : selected.playbackUrl;
    const tsUrl = xtreamDirect && selected.directTsPlaybackUrl ? selected.directTsPlaybackUrl : selected.tsPlaybackUrl;
    shell.innerHTML = `<video class="kz-main-video" controls autoplay muted playsinline webkit-playsinline></video>`;
    const video = shell.querySelector(".kz-main-video");
    if (!video) return;
    let localRecoveries = 0;
    let usingTsFallback = false;

    const refreshToken = () => {
      if (xtreamRecoveryCount >= 1) {
        showXtreamError("تعذر تشغيل القناة. ارجع إلى إدارة IPTV واختر قناة أخرى.");
        return;
      }
      xtreamRecoveryCount += 1;
      loadXtreamChannel().catch((error) => showXtreamError(error.message || error));
    };

    const playTsFallback = () => {
      if (usingTsFallback || !tsUrl || !window.mpegts?.isSupported()) {
        refreshToken();
        return;
      }
      usingTsFallback = true;
      if (activeHls) {
        try { activeHls.destroy(); } catch (_) { /* noop */ }
        activeHls = null;
      }
      video.pause();
      video.removeAttribute("src");
      video.load();
      activeMpegTs = window.mpegts.createPlayer(
        { type: "mpegts", isLive: true, url: tsUrl },
        { enableWorker: true, enableStashBuffer: false, stashInitialSize: 128 },
      );
      activeMpegTs.attachMediaElement(video);
      activeMpegTs.on(window.mpegts.Events.ERROR, refreshToken);
      activeMpegTs.load();
      const playTry = activeMpegTs.play();
      if (playTry?.catch) playTry.catch(() => bindUnmuteOverlay(video));
    };

    const onFatal = () => {
      localRecoveries += 1;
      if (activeHls && localRecoveries <= 2) {
        try { activeHls.startLoad(); return; } catch (_) { /* use TS below */ }
      }
      playTsFallback();
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      video.addEventListener("error", playTsFallback, { once: true });
    } else if (window.Hls && window.Hls.isSupported()) {
      activeHls = new window.Hls({
        enableWorker: true,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
        liveSyncDurationCount: 3,
      });
      activeHls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data || !data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          try { activeHls.recoverMediaError(); return; } catch (_) { /* use fatal recovery */ }
        }
        if (Number(data.response?.code || 0) >= 400) {
          playTsFallback();
          return;
        }
        onFatal();
      });
      activeHls.loadSource(hlsUrl);
      activeHls.attachMedia(video);
    } else {
      playTsFallback();
    }

    if (!usingTsFallback) {
      const playTry = video.play && video.play();
      if (playTry?.catch) playTry.catch(() => bindUnmuteOverlay(video));
    }
    bindUnmuteOverlay(video);
    loadedUrl = `xtream:${selected.portalId}:${selected.streamId}`;
  }

  async function loadXtreamChannel() {
    const selected = await fetchXtreamChannel();
    mountXtreamPlayer(selected);
    fillInfo();
    renderChannels();
    renderServers();
    renderSidebar();
  }

  function iframeSandboxAttr(noSandbox) {
    // noSandbox → emit NO sandbox attribute at all, so the frame is truly
    // unsandboxed (this is how go4score.app loads frame.php). Note: sandbox=""
    // is the MOST restrictive value, not the least — so "unsandboxed" must be
    // an omitted attribute, never an empty one. Returning "" here means no
    // sandbox=... token is written into the iframe markup.
    if (noSandbox) return "";
    return 'sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" ';
  }

  function removeFrameRecovery(frame, role) {
    const host = frame && frame.parentElement;
    if (!host) return;
    const marker = role || frame.dataset.kzWatchdogRole || "stream";
    host.querySelectorAll(`[data-kz-frame-recovery="${marker}"]`).forEach((el) => el.remove());
  }

  function showFrameRecovery(frame, role) {
    const host = frame && frame.parentElement;
    if (!host) return;
    const marker = role || frame.dataset.kzWatchdogRole || "stream";
    if (host.querySelector(`[data-kz-frame-recovery="${marker}"]`)) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.kzFrameRecovery = marker;
    btn.className = "kz-frame-recovery";
    btn.textContent = "إعادة تحميل البث";
    btn.style.cssText = [
      "position:absolute", "z-index:8", "left:14px", "bottom:14px",
      "border:1px solid rgba(255,255,255,.22)", "border-radius:999px",
      "background:rgba(10,14,23,.86)", "color:#fff", "padding:8px 14px",
      "font:700 13px Tajawal,system-ui", "cursor:pointer", "backdrop-filter:blur(10px)"
    ].join(";");
    btn.addEventListener("click", () => {
      removeFrameRecovery(frame, marker);
      bumpIframeHeal(frame);
      installIframeWatchdog(frame, { role: marker, force: true });
      showStreamHealToast();
    });
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(btn);
  }

  function installIframeWatchdog(frame, opts = {}) {
    if (!frame) return;
    const role = opts.role || frame.dataset.kzWatchdogRole || "stream";
    const prior = FRAME_WATCHDOGS.get(frame);
    if (prior && prior.timers) prior.timers.forEach(clearTimeout);
    removeFrameRecovery(frame, role);
    frame.dataset.kzWatchdogRole = role;

    let loaded = false;
    let attempts = 0;
    const timers = [];
    const cleanup = () => timers.splice(0).forEach(clearTimeout);
    const onLoad = () => {
      loaded = true;
      cleanup();
      removeFrameRecovery(frame, role);
    };
    frame.addEventListener("load", onLoad, { once: false });
    FRAME_WATCHDOGS.set(frame, { timers, cleanup });

    const schedule = (delay) => {
      timers.push(setTimeout(() => {
        if (loaded || !document.documentElement.contains(frame)) return;
        if (attempts < 2) {
          attempts += 1;
          bumpIframeHeal(frame);
          showStreamHealToast();
          schedule(attempts === 1 ? FRAME_SECOND_RETRY_MS : FRAME_LOAD_TIMEOUT_MS);
          return;
        }
        showFrameRecovery(frame, role);
      }, delay));
    };
    schedule(opts.force ? 250 : FRAME_LOAD_TIMEOUT_MS);
  }

  function loadIframePlayer(url, noSandbox) {
    if (!shell || !url) return;
    destroyInlineHls();
    if (loadedUrl === url) return;
    loadedUrl = url;
    const sandbox = iframeSandboxAttr(noSandbox);
    shell.innerHTML =
      `<iframe class="embed-frame" src="${url}" ` +
      `${sandbox}` +
      `allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen ` +
      `referrerpolicy="no-referrer" scrolling="no" loading="eager" fetchpriority="high"></iframe>`;
    installIframeWatchdog(shell.querySelector(".embed-frame"), { role: "main" });
  }

  // hls.js's default ABR starts from a conservative bandwidth guess (~500kbps)
  // and ramps up slowly, which reads as "stuck on low quality" on these master
  // playlists (144p-720p). Force the highest rendition as soon as the manifest
  // is known instead of waiting on the estimator.
  function forceHighestHlsLevel(hls) {
    hls.on(window.Hls.Events.MANIFEST_PARSED, (_e, data) => {
      const levels = data && data.levels;
      if (!levels || !levels.length) return;
      let best = 0;
      let bestBitrate = -1;
      levels.forEach((lvl, i) => {
        if (lvl.bitrate > bestBitrate) {
          bestBitrate = lvl.bitrate;
          best = i;
        }
      });
      hls.currentLevel = best;
    });
  }

  // Pinned main-player mirror for a specific match (see MANUAL_MIRROR_MATCHES).
  // Auto-loads in the main shell — unlike mountInlineHls, its only fallback is
  // the same-content mirror URL, never the generic vip/amine embed system, so
  // nothing else can silently switch this match away from the pinned source.
  function mountPinnedMainMirror(url, fallbackUrl, isIframe) {
    destroyInlineHls();
    if (!shell || !url) return;

    if (isIframe) {
      loadIframePlayer(url, false);
      loadedUrl = `pinned-mirror-iframe:${url}`;
      return;
    }

    shell.innerHTML = `<video class="kz-main-video" controls autoplay muted playsinline webkit-playsinline></video>`;
    const video = shell.querySelector(".kz-main-video");
    if (!video) return;

    const mount = (src, isFallbackAttempt) => {
      const onError = () => {
        destroyInlineHls();
        if (!isFallbackAttempt && fallbackUrl) {
          mount(fallbackUrl, true);
          return;
        }
        shell.innerHTML = `<div class="manual-mirror-error">${escapeHtml(t("watch.manualMirrorFailed"))}</div>`;
      };

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.addEventListener("error", onError, { once: true });
      } else if (window.Hls && window.Hls.isSupported()) {
        activeHls = new window.Hls({ enableWorker: false });
        activeHls.on(window.Hls.Events.ERROR, (_e, data) => {
          if (data && data.fatal) onError();
        });
        forceHighestHlsLevel(activeHls);
        activeHls.loadSource(src);
        activeHls.attachMedia(video);
      } else {
        video.src = src;
        video.addEventListener("error", onError, { once: true });
      }
    };

    mount(url, false);
    const playTry = video.play && video.play();
    if (playTry && playTry.catch) {
      playTry.catch(() => bindUnmuteOverlay(video));
    }
    bindUnmuteOverlay(video);
    loadedUrl = `pinned-mirror:${url}`;
  }

  async function loadPlayer() {
    if (!shell) return;
    if (xtreamMode) {
      if (activeXtreamChannel) mountXtreamPlayer(activeXtreamChannel);
      return;
    }
    const override = mainPlayerOverrideForMatch(match);
    if (override) {
      mountPinnedMainMirror(override.url, override.fallback, override.iframe);
      return;
    }
    const embed = currentEmbed();
    loadIframePlayer(embedUrlFor(embed, embedQuery(activeServ)), !!embed.noSandbox);
  }

  function reloadPlayer() {
    loadedUrl = "";
    destroyInlineHls();
    if (xtreamMode) {
      xtreamRecoveryCount = 0;
      loadXtreamChannel().catch((error) => showXtreamError(error.message || error));
      return;
    }
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
    const key = embedKey || (window.SITE_DATA && window.SITE_DATA.embedKeyFor(chId)) || "koraplus";
    const embed = { ...(window.SITE_DATA.embedForKey(key)), channelId: chId };
    const q = typeof serv === "object" ? serv : embedQuery(serv);
    if (q.serv == null) q.serv = serv;
    return embedUrlFor(embed, q);
  }

  function currentEmbed() {
    const key = activeEmbedKey || (match && match.embedKey) || (window.SITE_DATA && window.SITE_DATA.embedKeyFor(channel.id)) || "koraplus";
    return { ...(window.SITE_DATA.embedForKey(key)), channelId: channel.id };
  }

  function altStreamIframe(url, kind) {
    const noSandbox = kind === "ntv" || kind === "kooraCity";
    const sandbox = iframeSandboxAttr(noSandbox);
    return (
      `<iframe class="embed-frame alt-stream-frame" data-alt-kind="${escapeHtml(kind)}" src="${escapeHtml(url)}" ` +
      `${sandbox}` +
      `allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen ` +
      `referrerpolicy="${EMBED_REFERRER}" scrolling="no" loading="eager"></iframe>`
    );
  }

  function altStreamCssKind(kind) {
    if (kind === "daddyLive") return "daddy";
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
    installIframeWatchdog(stage.querySelector(".alt-stream-frame"), { role: `alt-${entry.kind}` });
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

  function initRobustFrameRecovery() {
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt > 60 * 1000) {
        healAllStreams("resume", { includeMain: false, force: true });
      }
    });
    window.addEventListener("online", () => healAllStreams("online", { includeMain: true, force: true }));
    window.addEventListener("pageshow", (ev) => {
      if (ev.persisted) healAllStreams("pageshow", { includeMain: false, force: true });
    });
  }

  function reloadAltStreams() {
    altStreamsSignature = "";
    const card = document.getElementById("alt-streams");
    if (card) card.dataset.altTabsBound = "";
    renderAltStreams();
  }

  // ---------------------------------------------------------------------
  // Manual mirror cards (see MANUAL_MIRROR_MATCHES above). Fully separate
  // from the alt-stream tabs: nothing here is wired into healAllStreams,
  // initAltStreamHeal's postMessage listener, or STREAM_HEAL_MIN_MS. Nothing
  // plays until the user clicks a card; a card only retries its own
  // same-content `fallback` mirror on error, never a different card.
  // ---------------------------------------------------------------------
  let manualMirrorHls = null;
  let activeManualMirrorId = "";

  function destroyManualMirrorHls() {
    if (!manualMirrorHls) return;
    try {
      manualMirrorHls.destroy();
    } catch {
      /* noop */
    }
    manualMirrorHls = null;
  }

  function manualMirrorCardHtml(cardDef, isActive) {
    const activeClass = isActive ? " is-active" : "";
    return (
      `<button type="button" class="alt-stream-tab${activeClass}" ` +
      `data-mirror-id="${escapeHtml(cardDef.id)}" aria-pressed="${isActive ? "true" : "false"}">` +
      `<span class="alt-stream-name">${escapeHtml(cardDef.label)}</span>` +
      `</button>`
    );
  }

  function playManualMirrorUrl(stage, url, cardDef, isFallbackAttempt) {
    stage.innerHTML = `<video class="kz-main-video" controls autoplay muted playsinline webkit-playsinline></video>`;
    const video = stage.querySelector("video");
    if (!video) return;

    const onFatalError = () => {
      destroyManualMirrorHls();
      if (!isFallbackAttempt && cardDef.fallback) {
        playManualMirrorUrl(stage, cardDef.fallback, cardDef, true);
        return;
      }
      stage.innerHTML = `<div class="manual-mirror-error">${escapeHtml(t("watch.manualMirrorFailed"))}</div>`;
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.addEventListener("error", onFatalError, { once: true });
    } else if (window.Hls && window.Hls.isSupported()) {
      manualMirrorHls = new window.Hls({ enableWorker: false });
      manualMirrorHls.on(window.Hls.Events.ERROR, (_e, data) => {
        if (data && data.fatal) onFatalError();
      });
      forceHighestHlsLevel(manualMirrorHls);
      manualMirrorHls.loadSource(url);
      manualMirrorHls.attachMedia(video);
    } else {
      video.src = url;
      video.addEventListener("error", onFatalError, { once: true });
    }

    const playTry = video.play && video.play();
    if (playTry && playTry.catch) {
      playTry.catch(() => bindUnmuteOverlay(video));
    }
    bindUnmuteOverlay(video);
  }

  function selectManualMirrorCard(cardId, cards) {
    const cardDef = cards.find((c) => c.id === cardId);
    if (!cardDef) return;
    activeManualMirrorId = cardId;
    const wrap = document.getElementById("manual-mirrors");
    if (!wrap) return;
    wrap.querySelectorAll(".alt-stream-tab").forEach((btn) => {
      const active = btn.dataset.mirrorId === cardId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const stage = wrap.querySelector(".alt-stream-stage");
    if (!stage) return;
    destroyManualMirrorHls();
    playManualMirrorUrl(stage, cardDef.url, cardDef, false);
  }

  function renderManualMirrors() {
    const wrap = document.getElementById("manual-mirrors");
    if (!wrap) return;
    const cards = manualMirrorsForMatch(match);
    if (!cards || !cards.length) {
      wrap.hidden = true;
      wrap.innerHTML = "";
      wrap.dataset.mirrorsBound = "";
      activeManualMirrorId = "";
      destroyManualMirrorHls();
      return;
    }
    if (wrap.dataset.mirrorsBound === "1") {
      wrap.hidden = false;
      return; // already rendered for this match; clicks are user-driven only
    }
    wrap.dataset.mirrorsBound = "1";
    activeManualMirrorId = "";
    const tabs = cards.map((c) => manualMirrorCardHtml(c, false)).join("");
    wrap.hidden = false;
    wrap.innerHTML =
      `<div class="alt-streams-head">
        <h3 class="alt-streams-title">${escapeHtml(t("watch.manualMirrorsTitle"))}</h3>
        <p class="alt-streams-note">${escapeHtml(t("watch.manualMirrorsNote"))}</p>
      </div>
      <div class="alt-stream-tabs" role="tablist">${tabs}</div>
      <div class="alt-stream-stage"><div class="manual-mirror-empty">${escapeHtml(t("watch.manualMirrorsPick"))}</div></div>`;
    wrap.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-mirror-id]");
      if (!btn) return;
      selectManualMirrorCard(btn.dataset.mirrorId, cards);
    });
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
    if (xtreamMode) {
      const name = activeXtreamChannel?.name || params.get("name") || "IPTV";
      const category = activeXtreamChannel?.categoryName || params.get("category") || "IPTV";
      const portalLabel = activeXtreamChannel?.portalLabel || xtreamPortalId || "IPTV";
      document.getElementById("ch-name").textContent = name;
      document.getElementById("ch-status").innerHTML = '<span class="status-pill status-live">IPTV مباشر</span>';
      document.title = `${name} — KoraZero`;
      document.getElementById("now-sub").textContent = `${portalLabel} · ${category}`;
      document.getElementById("info-quality").textContent = "Live";
      document.getElementById("info-group").textContent = category;
      const route = document.getElementById("info-route");
      if (route) route.textContent = `${xtreamDirect ? "Xtream Direct" : "Xtream"} · ${portalLabel}`;
      document.getElementById("info-commentator").textContent = "—";
      document.getElementById("info-league").textContent = category;
      const times = document.getElementById("info-times");
      if (times) times.textContent = "—";
      ["match-detail-slot", "match-summary-slot", "match-poll-slot", "match-notice-slot"].forEach((id) => {
        const node = document.getElementById(id);
        if (node) node.innerHTML = "";
      });
      return;
    }
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
    if (xtreamMode) {
      const name = activeXtreamChannel?.name || params.get("name") || "IPTV";
      row.innerHTML = `<a class="channel-btn active" href="iptv-admin.html"><span class="channel-btn-name">${escapeHtml(name)}</span><span class="channel-btn-tag">إدارة IPTV</span></a>`;
      return;
    }
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
    if (key === "koraplus") return "KoraPlus";
    if (key === "kooracity") return "Koora City";
    if (key === "sirtv") return "Sir TV";
    if (key === "ntv") return "NTV";
    return String(key || "").toUpperCase();
  }

  function renderServers({ rebind } = {}) {
    const row = document.getElementById("servers");
    if (!row) return;
    if (xtreamMode) {
      const portal = activeXtreamChannel?.portalLabel || xtreamPortalId || "IPTV";
      row.innerHTML = `<div class="server-groups server-groups--clean"><div class="server-group"><div class="server-group-label">Xtream</div><div class="server-group-row"><span class="server-status-pill srv-ok">${escapeHtml(portal)} ← ${escapeHtml(activeXtreamChannel?.name || "IPTV")}</span></div></div></div>`;
      return;
    }
    const defaultKey = (match && match.embedKey) || window.SITE_DATA.embedKeyFor(channel.id) || "koraplus";
    row.innerHTML = `<div class="server-groups server-groups--clean">
      <div class="server-group" data-group="${escapeHtml(defaultKey)}">
        <div class="server-group-label">${sourceLabel(defaultKey)}</div>
        <div class="server-group-row">
          <span class="server-status-pill srv-ok">${sourceLabel(defaultKey)} ← ${escapeHtml(channel.name || channel.id)}</span>
        </div>
      </div>
    </div>`;
    row.dataset.ch = channel.id;
    row.dataset.embed = defaultKey;
    row.dataset.serv = "primary";
  }

  function renderSidebar() {
    const panel = document.getElementById("side-channels");
    if (!panel) return;
    if (xtreamMode) {
      panel.innerHTML = `<a class="side-match active" href="iptv-admin.html"><span class="side-status status-live">IPTV</span><span class="side-teams">إدارة واختيار القنوات</span><span class="side-league">العودة إلى لوحة IPTV</span></a>`;
      return;
    }
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
    renderManualMirrors();
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
    initRobustFrameRecovery();
    initReloadButton();
    if (xtreamMode) {
      try {
        await loadXtreamChannel();
      } catch (error) {
        showXtreamError(error.message || error);
        fillInfo();
        renderChannels();
        renderServers();
        renderSidebar();
      }
      return;
    }
    loadPlayer();
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
      renderManualMirrors();
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
