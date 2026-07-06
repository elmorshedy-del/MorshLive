/**
 * Streams Lab — 24/7 beIN hub (dlhd + SIR + siir-tv.live).
 * Does not touch main watch page STREAM_SOURCES.
 */
(function () {
  const iframe = document.getElementById("player");
  const video = document.getElementById("lab-video");
  const clapprEl = document.getElementById("lab-clappr");
  const grid = document.getElementById("channel-grid");
  const groupTabs = document.getElementById("group-tabs");
  const nowLabel = document.getElementById("now-label");
  const statusLine = document.getElementById("status-line");
  const liveCountEl = document.getElementById("live-count");
  const totalCountEl = document.getElementById("total-count");
  const externalLinks = document.getElementById("external-links");
  const sir247Grid = document.getElementById("sir-247-grid");
  const siirMatchesGrid = document.getElementById("siir-matches-grid");
  const siirMatchesStatus = document.getElementById("siir-matches-status");
  const reloadBtn = document.getElementById("reload");
  const bestBtn = document.getElementById("best-btn");
  const refreshBtn = document.getElementById("refresh-status");

  const PRIMARY_GROUPS = ["ar", "max", "sir"];
  const GROUP_PICK_ORDER = { ar: 1, max: 2, sir: 3, other: 99 };
  const REGION_STATS = ["ar", "max", "sir"];

  let catalog = { channels: [], groups: [], external: [], defaultGroup: "ar" };
  let apiBest = null;
  let sir247 = [];
  let siirMatches = [];
  let currentRoute = null;
  let currentGroup = "ar";
  let probed = false;
  let refreshInFlight = null;
  let hlsInstance = null;
  let stallTimer = null;
  let clapprPlayer = null;
  let sourceIndex = 0;
  let currentSources = [];
  let loadGen = 0;
  let sourceTries = 0;

  const LAB_DL_RE = /^\/lab\/dl\/(\d{1,6})\/?$/i;

  function setStatus(msg) {
    if (statusLine) statusLine.textContent = msg;
  }

  function kzHlsOpts() {
    return {
      enableWorker: true,
      lowLatencyMode: false,
      startPosition: -1,
      maxBufferLength: 14,
      maxMaxBufferLength: 28,
      backBufferLength: 30,
      liveSyncDurationCount: 2,
      liveMaxLatencyDurationCount: 6,
      liveDurationInfinity: true,
      maxLiveSyncPlaybackRate: 1.35,
      highBufferWatchdogPeriod: 2,
      maxBufferHole: 0.5,
      nudgeOffset: 0.12,
      nudgeMaxRetry: 4,
      initialLiveManifestSize: 1,
      startFragPrefetch: true,
      manifestLoadingMaxRetry: 6,
      manifestLoadingTimeOut: 10000,
      levelLoadingMaxRetry: 4,
      fragLoadingMaxRetry: 6,
      fragLoadingTimeOut: 12000,
      abrEwmaFastLive: 3,
      abrEwmaSlowLive: 9,
      capLevelToPlayerSize: true,
    };
  }

  function kzAttachHls(v, src, onFatal) {
    const Hls = window.Hls;
    const hls = new Hls(kzHlsOpts());
    hls.loadSource(src);
    hls.attachMedia(v);
    hls.on(Hls.Events.ERROR, (_e, d) => {
      if (!d || !d.fatal) return;
      if (d.type === "networkError") {
        setTimeout(() => {
          try {
            hls.startLoad();
          } catch {
            onFatal();
          }
        }, 1000);
        return;
      }
      if (d.type === "mediaError") {
        try {
          hls.recoverMediaError();
          return;
        } catch {
          /* fall through */
        }
      }
      onFatal();
    });
    return hls;
  }

  function kzWatchStall(v, onStall) {
    let lastCt = 0;
    let stallMs = 0;
    return setInterval(() => {
      if (v.paused || v.readyState < 2) {
        stallMs = 0;
        lastCt = v.currentTime;
        return;
      }
      if (v.currentTime > 0 && v.currentTime === lastCt) {
        stallMs += 3000;
        if (stallMs >= 12000) {
          stallMs = 0;
          onStall();
        }
      } else {
        stallMs = 0;
      }
      lastCt = v.currentTime;
    }, 3000);
  }

  function destroyClappr() {
    if (clapprPlayer) {
      try {
        clapprPlayer.destroy();
      } catch {
        /* ignore */
      }
      clapprPlayer = null;
    }
    if (clapprEl) clapprEl.innerHTML = "";
  }

  function destroyHls() {
    if (stallTimer) {
      clearInterval(stallTimer);
      stallTimer = null;
    }
    if (hlsInstance) {
      try {
        hlsInstance.destroy();
      } catch {
        /* ignore */
      }
      hlsInstance = null;
    }
    if (video) {
      video.onerror = null;
      video.onloadeddata = null;
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* ignore */
      }
    }
  }

  function showPlayer(mode) {
    if (clapprEl) clapprEl.classList.toggle("is-hidden", mode !== "clappr");
    if (video) video.classList.toggle("is-hidden", mode !== "video");
    if (iframe) iframe.classList.toggle("is-hidden", mode !== "iframe");
  }

  function dlhdIdFromRoute(route) {
    const m = String(route || "").match(LAB_DL_RE);
    return m ? m[1] : null;
  }

  function routeUsesIframe(route) {
    return route && !LAB_DL_RE.test(route);
  }

  function tryPlayVideo() {
    if (!video) return;
    const p = video.play && video.play();
    if (p && p.catch) p.catch(() => {});
  }

  function nextSource(gen) {
    if (gen !== loadGen || !currentSources.length) return;
    sourceIndex = (sourceIndex + 1) % currentSources.length;
    sourceTries++;
    if (sourceTries <= currentSources.length * 6) {
      setTimeout(() => playCurrentSource(gen), 400);
    } else {
      setStatus("تعذّر تشغيل البث — جرّب إعادة التحميل أو قناة أخرى");
    }
  }

  function playCurrentSource(gen) {
    if (gen !== loadGen || !video || !currentSources.length) return;
    const src = currentSources[sourceIndex];
    if (!src) return;

    destroyHls();

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.onerror = () => nextSource(gen);
      video.onloadeddata = () => {
        sourceTries = 0;
      };
      tryPlayVideo();
      return;
    }

    if (window.Hls && window.Hls.isSupported()) {
      hlsInstance = kzAttachHls(video, src, () => nextSource(gen));
      stallTimer = kzWatchStall(video, () => nextSource(gen));
      tryPlayVideo();
      return;
    }

    video.src = src;
    tryPlayVideo();
  }

  async function playLabClappr(m3u8, id, label, route) {
    if (!clapprEl || !window.Clappr) return false;
    destroyClappr();
    destroyHls();
    showPlayer("clappr");
    if (iframe) iframe.src = "about:blank";

    const p2pConfig = {
      live: true,
      token: "greek",
      channelId: String(id),
      announce: "https://ann.cdn-lab.shop/v1",
      showSlogan: false,
      sharePlaylist: false,
      startFromSegmentOffset: 0,
      trickleICE: true,
    };

    if (window.P2PEngineHls) {
      try {
        await P2PEngineHls.tryRegisterServiceWorker(p2pConfig);
      } catch {
        /* P2P optional */
      }
    }

    clapprPlayer = new Clappr.Player({
      source: m3u8,
      parent: clapprEl,
      mimeType: "application/x-mpegURL",
      width: "100%",
      height: "100%",
      autoPlay: true,
      mute: true,
      playback: {
        playInline: true,
        hlsjsConfig: {
          maxBufferLength: 5,
          liveSyncDurationCount: 3,
        },
      },
    });

    if (window.P2PEngineHls) {
      try {
        p2pConfig.hlsjsInstance = clapprPlayer.core.getCurrentPlayback()?._hls;
        new P2PEngineHls(p2pConfig);
      } catch {
        /* fall back to plain hls.js inside Clappr */
      }
    }

    setStatus("البث: " + (label || route));
    return true;
  }

  async function playLabDlhd(route, label) {
    const id = dlhdIdFromRoute(route);
    if (!id) return false;

    const gen = ++loadGen;
    sourceIndex = 0;
    sourceTries = 0;
    currentSources = [];

    currentRoute = route;
    if (nowLabel) nowLabel.textContent = label || route;
    document.querySelectorAll(".lab-card").forEach((el) => {
      el.classList.toggle("active", el.dataset.route === route);
    });

    setStatus("جارٍ تشغيل البث…");

    let m3u8 = null;
    try {
      const res = await fetch("/api/lab-stream/" + id, { cache: "no-store" });
      const data = await res.json();
      if (gen !== loadGen) return true;
      if (data.ok) {
        m3u8 = data.m3u8 || null;
        if (Array.isArray(data.sources) && data.sources.length) {
          currentSources = data.sources.filter(Boolean);
        }
      }
    } catch {
      /* fall through */
    }

    if (gen !== loadGen) return true;

    if (m3u8 && (await playLabClappr(m3u8, id, label, route))) {
      return true;
    }

    if (currentSources.length && video) {
      showPlayer("video");
      if (iframe) iframe.src = "about:blank";
      playCurrentSource(gen);
      setStatus("البث (احتياطي): " + (label || route));
      return true;
    }

    showPlayer("iframe");
    destroyClappr();
    destroyHls();
    if (iframe) iframe.src = route;
    setStatus("تشغيل عبر صفحة مضمّنة — " + (label || route));
    return true;
  }

  function loadRoute(route, label) {
    if (!route) return Promise.resolve();
    currentRoute = route;

    if (routeUsesIframe(route)) {
      loadGen++;
      destroyClappr();
      destroyHls();
      showPlayer("iframe");
      if (iframe) iframe.src = route;
      if (nowLabel) nowLabel.textContent = label || route;
      document.querySelectorAll(".lab-card").forEach((el) => {
        el.classList.toggle("active", el.dataset.route === route);
      });
      setStatus("البث: " + (label || route));
      return Promise.resolve();
    }

    return playLabDlhd(route, label);
  }

  function channelLabel(ch) {
    let t = ch.name;
    if (ch.sub) t += " — " + ch.sub;
    if (ch.mirror) t += " (مرآة)";
    return t;
  }

  function channelById(id) {
    return (catalog.channels || []).find((c) => c.id === id) || null;
  }

  function filteredChannels() {
    const list = catalog.channels || [];
    if (currentGroup === "all") return list;
    return list.filter((c) => c.group === currentGroup);
  }

  function groupLiveCount(groupId) {
    const list = catalog.channels || [];
    const scoped = groupId === "all" ? list : list.filter((c) => c.group === groupId);
    return scoped.filter((c) => c.live).length;
  }

  function isPrimaryChannel(ch) {
    return PRIMARY_GROUPS.includes(ch.group);
  }

  function groupPickRank(ch) {
    return GROUP_PICK_ORDER[ch.group] || 50;
  }

  function updateLiveUi() {
    const channels = catalog.channels || [];
    const liveCount = channels.filter((c) => c.live).length;
    const arLive = channels.filter((c) => c.live && isPrimaryChannel(c)).length;
    if (liveCountEl) liveCountEl.textContent = arLive ? String(arLive) + " عربي" : String(liveCount);
    if (totalCountEl) totalCountEl.textContent = String(channels.filter(isPrimaryChannel).length || channels.length);
    updateRegionStats();
    renderGroups();
    renderGrid();
  }

  function updateRegionStats() {
    REGION_STATS.forEach((gid) => {
      const el = document.getElementById("stat-" + gid);
      if (!el) return;
      const live = groupLiveCount(gid);
      const total = (catalog.channels || []).filter((c) => c.group === gid).length;
      el.textContent = probed ? live + "/" + total : "—";
    });
  }

  function renderGroups() {
    if (!groupTabs) return;
    groupTabs.innerHTML = "";
    const hash = (location.hash || "").replace("#", "");
    const valid = (catalog.groups || []).some((g) => g.id === hash);
    if (hash && valid) currentGroup = hash;
    else if (!hash && catalog.defaultGroup) currentGroup = catalog.defaultGroup;

    const groups = [...(catalog.groups || [])];
    groups.push({ id: "all", label: "الكل", icon: "★" });
    groups.forEach((g) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lab-group" + (currentGroup === g.id ? " active" : "");
      b.dataset.group = g.id;
      const cnt = probed ? groupLiveCount(g.id) : null;
      const cntHtml = cnt !== null && g.id !== "match" ? `<span class="cnt">${cnt}</span>` : "";
      b.innerHTML = `<span>${g.icon || ""}</span> ${g.label}${cntHtml}`;
      b.addEventListener("click", () => {
        currentGroup = g.id;
        history.replaceState(null, "", g.id === "all" ? location.pathname : "#" + g.id);
        renderGroups();
        renderGrid();
      });
      groupTabs.appendChild(b);
    });
  }

  function cardClass(ch) {
    if (ch.live === true) return " is-live";
    if (ch.live === false) return " is-dead";
    return " is-unknown";
  }

  function renderGrid() {
    if (!grid) return;
    grid.innerHTML = "";
    const list = filteredChannels().sort((a, b) => (a.priority || 99) - (b.priority || 99));
    list.forEach((ch) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "lab-card" + cardClass(ch);
      card.dataset.route = ch.route;
      const sub = ch.mirror ? (ch.sub || ch.source) + " · مرآة" : ch.sub || ch.source;
      card.innerHTML =
        `<span class="lab-dot" aria-hidden="true"></span>` +
        `<span class="lab-card-name">${ch.name}</span>` +
        `<span class="lab-card-sub">${sub}</span>`;
      card.addEventListener("click", () => loadRoute(ch.route, channelLabel(ch)));
      grid.appendChild(card);
    });
  }

  function renderExternal() {
    if (!externalLinks) return;
    externalLinks.innerHTML = "";
    (catalog.external || [])
      .sort((a, b) => (a.priority || 99) - (b.priority || 99))
      .forEach((ex) => {
        const a = document.createElement("a");
        a.className = "lab-ext";
        a.href = ex.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.innerHTML = `<strong>${ex.name}</strong><small>${ex.sub}</small>`;
        externalLinks.appendChild(a);
      });
  }

  function renderSir247() {
    if (!sir247Grid) return;
    sir247Grid.innerHTML = "";
    const list = sir247.length
      ? sir247
      : (catalog.channels || []).filter((c) => c.source === "sir").map((c) => ({
          slug: c.sirSlug,
          name: c.name,
          route: c.route,
          live: c.live,
          sub: c.sub,
        }));
    list.forEach((ch) => {
      const card = document.createElement("button");
      card.type = "button";
      const live = ch.live === true;
      card.className = "lab-card" + (live ? " is-live" : ch.live === false ? " is-dead" : " is-unknown");
      card.dataset.route = ch.route;
      card.innerHTML =
        `<span class="lab-dot" aria-hidden="true"></span>` +
        `<span class="lab-card-name">${ch.name}</span>` +
        `<span class="lab-card-sub">${ch.sub || "24/7"} · SIR</span>`;
      card.addEventListener("click", () => loadRoute(ch.route, ch.name + " 24/7"));
      sir247Grid.appendChild(card);
    });
  }

  function siirStatusLabel(status) {
    if (status === "live") return "مباشر";
    if (status === "soon") return "قريباً";
    if (status === "ended") return "انتهت";
    return "—";
  }

  function renderSiirMatches() {
    if (!siirMatchesGrid) return;
    siirMatchesGrid.innerHTML = "";
    if (!siirMatches.length) {
      if (siirMatchesStatus) siirMatchesStatus.textContent = "لا توجد مباريات في siir-tv.live حالياً";
      return;
    }
    const liveN = siirMatches.filter((m) => m.live).length;
    if (siirMatchesStatus) {
      siirMatchesStatus.textContent = liveN
        ? `${liveN} مباراة ببث متاح · ${siirMatches.length} إجمالي`
        : `${siirMatches.length} مباراة — البث يظهر عند بدء المباراة`;
    }
    siirMatches.forEach((m) => {
      const card = document.createElement("button");
      card.type = "button";
      const cls =
        m.status === "live" ? " match-live is-live" : m.status === "soon" ? " match-soon" : " match-ended is-dead";
      card.className = "lab-card" + cls;
      const label = m.home && m.away ? `${m.home} × ${m.away}` : m.title;
      const sub = [m.channel, m.time, siirStatusLabel(m.status)].filter(Boolean).join(" · ");
      card.innerHTML =
        `<span class="lab-dot" aria-hidden="true"></span>` +
        `<span class="lab-card-name">${label}</span>` +
        `<span class="lab-card-sub">${sub}</span>`;
      if (m.route && m.live) {
        card.dataset.route = m.route;
        card.addEventListener("click", () => loadRoute(m.route, label));
      } else {
        card.disabled = true;
        card.style.cursor = "default";
      }
      siirMatchesGrid.appendChild(card);
    });
  }

  async function refreshSiirMatches() {
    try {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 22_000) : null;
      const res = await fetch("/api/siir-matches", {
        cache: "no-store",
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "siir-matches failed");
      siirMatches = data.matches || [];
      if (data.sir247?.length) {
        sir247 = data.sir247.map((ch) => ({
          ...ch,
          sub: ch.slug === "ar1" || ch.slug === "ar2" ? "عربي" : ch.slug === "fr" ? "Français" : "English",
        }));
        renderSir247();
        const sirMap = new Map(sir247.map((c) => [c.slug, c.live]));
        catalog.channels = (catalog.channels || []).map((ch) => {
          if (ch.source !== "sir" || !ch.sirSlug) return ch;
          const fromApi = sirMap.get(ch.sirSlug);
          return fromApi === undefined ? ch : { ...ch, live: !!fromApi };
        });
        if (probed) updateLiveUi();
      }
      renderSiirMatches();
      return data;
    } catch {
      if (siirMatchesStatus) siirMatchesStatus.textContent = "تعذّر تحميل مباريات siir-tv.live";
      return null;
    }
  }

  function pickBest(autoPlay) {
    const live = (catalog.channels || []).filter((c) => c.live);
    if (live.length) {
      const primary = live.filter(isPrimaryChannel);
      const pool = primary.length ? primary : live;
      pool.sort((a, b) => {
        const g = groupPickRank(a) - groupPickRank(b);
        if (g !== 0) return g;
        return (a.priority || 99) - (b.priority || 99);
      });
      const best = pool[0];
      if (autoPlay) loadRoute(best.route, channelLabel(best));
      return best;
    }

    if (apiBest?.route && autoPlay) {
      const ch = channelById(apiBest.id) || apiBest;
      loadRoute(apiBest.route, channelLabel(ch));
      return apiBest;
    }

    const fallback = (catalog.channels || [])
      .filter(isPrimaryChannel)
      .sort((a, b) => (a.priority || 99) - (b.priority || 99))[0];
    if (fallback?.route && autoPlay) {
      loadRoute(fallback.route, channelLabel(fallback));
      return fallback;
    }

    if (autoPlay) setStatus("لا يوجد بث عربي متاح حالياً — جرّب قناة يدوياً أو أعد الفحص");
    return null;
  }

  function mergeApiChannels(apiData) {
    const apiMap = new Map((apiData.channels || []).map((c) => [c.id, c]));
    const merged = (catalog.channels || []).map((ch) => {
      const fromApi = apiMap.get(ch.id);
      if (!fromApi) return ch;
      const live = fromApi.live === true ? true : fromApi.live === false ? false : ch.live;
      return {
        ...ch,
        live,
        route: fromApi.route || ch.route,
        mirror: fromApi.mirror || null,
      };
    });
    catalog.channels = merged.sort((a, b) => (a.priority || 99) - (b.priority || 99));
    apiBest = apiData.best || null;
    catalog.external = apiData.external || catalog.external;
    probed = true;
    updateLiveUi();
    renderExternal();
    renderSir247();

    const ts = new Date().toLocaleTimeString("ar-SA");
    const liveCount = catalog.channels.filter((c) => c.live).length;
    const arLive = catalog.channels.filter((c) => c.live && isPrimaryChannel(c)).length;
    setStatus(`آخر فحص: ${ts} — ${arLive} عربي · ${liveCount} إجمالي`);
  }

  async function refreshStatus() {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      setStatus("جارٍ فحص المصادر…");
      try {
        if (!(catalog.channels || []).length) {
          const res = await fetch("/assets/data/streams-lab.json", { cache: "no-store" });
          const data = await res.json();
          catalog = { ...data, channels: (data.channels || []).map((c) => ({ ...c, live: null })) };
          catalog.external = data.external || [];
          catalog.groups = data.groups || [];
        }

        refreshSiirMatches();

        const apiRes = await fetch("/api/streams-lab", { cache: "no-store" });
        const apiData = await apiRes.json();
        if (!apiData.ok) throw new Error(apiData.error || "probe failed");

        mergeApiChannels(apiData);

        if (!currentRoute) pickBest(true);
        return catalog;
      } catch (e) {
        setStatus("تعذّر فحص المصادر: " + (e.message || e));
        if (!currentRoute) pickBest(true);
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  }

  if (reloadBtn) {
    reloadBtn.addEventListener("click", () => {
      const keep = currentRoute;
      const lbl = nowLabel ? nowLabel.textContent : keep;
      loadGen++;
      destroyClappr();
      destroyHls();
      if (iframe) iframe.src = "about:blank";
      setTimeout(() => loadRoute(keep, lbl), 120);
    });
  }
  if (bestBtn) bestBtn.addEventListener("click", () => pickBest(true));
  if (refreshBtn) refreshBtn.addEventListener("click", () => refreshStatus());

  fetch("/assets/data/streams-lab.json")
    .then((r) => r.json())
    .then((data) => {
      catalog = { ...data, channels: (data.channels || []).map((c) => ({ ...c, live: null })) };
      currentGroup = data.defaultGroup || "ar";
      if (totalCountEl) totalCountEl.textContent = String((data.channels || []).filter(isPrimaryChannel).length);
      renderGroups();
      renderGrid();
      renderExternal();
      renderSir247();
      const quick = (catalog.channels || [])
        .filter(isPrimaryChannel)
        .sort((a, b) => (a.priority || 99) - (b.priority || 99))[0];
      if (quick?.route && !currentRoute) loadRoute(quick.route, channelLabel(quick));
    })
    .catch(() => setStatus("تعذّر تحميل القائمة"))
    .finally(() => refreshStatus());

  setInterval(() => refreshStatus(), 90_000);
  setInterval(() => refreshSiirMatches(), 90_000);
})();
