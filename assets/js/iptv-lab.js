(() => {
  "use strict";

  const statusEl = document.getElementById("portalStatus");
  const categorySelect = document.getElementById("categorySelect");
  const searchInput = document.getElementById("searchInput");
  const filterForm = document.getElementById("filterForm");
  const refreshBtn = document.getElementById("refreshBtn");
  const resultCount = document.getElementById("resultCount");
  const channelGrid = document.getElementById("channelGrid");
  const errorBox = document.getElementById("errorBox");
  const video = document.getElementById("previewVideo");
  const playerBox = document.getElementById("playerBox");
  const playerEmpty = document.getElementById("playerEmpty");
  const playerState = document.getElementById("playerState");
  const playerTools = document.getElementById("playerTools");
  const fsBtn = document.getElementById("fsBtn");
  const pipBtn = document.getElementById("pipBtn");
  const selectedName = document.getElementById("selectedName");
  const selectedMeta = document.getElementById("selectedMeta");
  const selectedMetaChip = document.getElementById("selectedMetaChip");

  const recBtn = document.getElementById("recBtn");

  const SPORT_RE = /bein|sport|dazn|espn|sky|ssn|tnt|premiere|liga|football/i;
  const REC_DEFAULT_LABEL = "▶ AR BEIN SPORTS 1 SD";

  function isArBeinSportsSdCategory(name) {
    const text = String(name || "");
    if (!/^\s*ar\b/i.test(text)) return false;
    if (!/bein/i.test(text)) return false;
    if (!/\bsd\b/i.test(text)) return false;
    if (/\btod\b/i.test(text) || /english/i.test(text)) return false;
    return true;
  }

  function isArBeinSports1SdChannel(channel) {
    const name = String(channel?.name || "").trim();
    if (/english/i.test(name)) return false;
    if (!/bein\s+sports?\s+(?:1\s+sd|sd\s*1)$/i.test(name)) return false;
    return isArBeinSportsSdCategory(channel?.categoryName);
  }

  function pickArBeinSports1Sd(list) {
    const matches = (Array.isArray(list) ? list : []).filter(isArBeinSports1SdChannel);
    return matches.find((channel) => String(channel.streamId) === "991") || matches[0] || null;
  }

  let categories = [];
  let channels = [];
  let hls = null;
  let mpegTsPlayer = null;
  let loadController = null;
  let reconnectTimer = null;
  let playbackGeneration = 0;

  function setError(message) {
    errorBox.hidden = !message;
    errorBox.textContent = message || "";
  }

  async function getJson(url, signal) {
    const response = await fetch(url, { cache: "no-store", signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  function addOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function formatExp(unix) {
    const n = Number(unix);
    if (!n) return "";
    return `${new Date(n * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC`;
  }

  async function loadStatus() {
    const data = await getJson("/api/iptv-lab/status");
    statusEl.replaceChildren();
    const portal = data.portals && data.portals[0];
    if (!portal) {
      const chip = document.createElement("span");
      chip.className = "status-chip down";
      chip.textContent = "لا توجد بوابة تجريبية";
      statusEl.appendChild(chip);
      return;
    }
    const account = portal.account || {};
    const active = Boolean(portal.ok && Number(account.auth) === 1 && String(account.status || "").toLowerCase() === "active");
    const chip = document.createElement("span");
    chip.className = `status-chip ${active ? "ok" : "down"}`;
    const exp = formatExp(account.expDate);
    const conns = account.maxConnections ? ` · ${account.maxConnections} اتصال` : "";
    chip.textContent = `${portal.label}: ${active ? "نشط" : portal.error || account.status || "متوقف"}${exp ? ` حتى ${exp}` : ""}${conns}`;
    statusEl.appendChild(chip);
  }

  function preferredCategoryId() {
    const arBeinSd = categories.find((category) => isArBeinSportsSdCategory(category.name));
    if (arBeinSd?.categoryId) return String(arBeinSd.categoryId);
    const scored = categories
      .map((category) => ({
        category,
        score: /ca/i.test(category.name) && SPORT_RE.test(category.name)
          ? 4
          : /bein/i.test(category.name)
            ? 3
            : SPORT_RE.test(category.name)
              ? 2
              : 0,
      }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.category.name.localeCompare(b.category.name, "ar"));
    return scored[0]?.category.categoryId || "";
  }

  function renderCategoryOptions(preferredId) {
    const selectedValue = preferredId || categorySelect.value;
    categorySelect.replaceChildren();
    addOption(categorySelect, "", "كل الفئات");
    const seen = new Set();
    [...categories]
      .sort((a, b) => {
        const aSport = SPORT_RE.test(a.name) ? 0 : 1;
        const bSport = SPORT_RE.test(b.name) ? 0 : 1;
        return aSport - bSport || a.name.localeCompare(b.name, "ar");
      })
      .forEach((category) => {
        if (seen.has(category.categoryId)) return;
        seen.add(category.categoryId);
        addOption(categorySelect, category.categoryId, category.name);
      });
    if ([...categorySelect.options].some((option) => option.value === selectedValue)) {
      categorySelect.value = selectedValue;
    }
  }

  async function loadCategories() {
    const data = await getJson("/api/iptv-lab/categories");
    categories = (data.portals || []).flatMap((block) => block.categories || []);
    renderCategoryOptions(preferredCategoryId());
  }

  function channelInitial(name) {
    const words = String(name || "TV").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "TV";
  }

  function channelCard(channel) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "channel";
    button.dataset.streamId = String(channel.streamId || "");

    let logo;
    if (channel.icon) {
      logo = document.createElement("img");
      logo.className = "channel-logo";
      logo.alt = "";
      logo.loading = "lazy";
      logo.referrerPolicy = "no-referrer";
      logo.src = channel.icon;
      logo.addEventListener("error", () => {
        const fallback = document.createElement("span");
        fallback.className = "channel-logo channel-fallback";
        fallback.textContent = channelInitial(channel.name);
        logo.replaceWith(fallback);
      }, { once: true });
    } else {
      logo = document.createElement("span");
      logo.className = "channel-logo channel-fallback";
      logo.textContent = channelInitial(channel.name);
    }

    const copy = document.createElement("span");
    const name = document.createElement("span");
    name.className = "channel-name";
    name.textContent = channel.name;
    const meta = document.createElement("span");
    meta.className = "channel-meta";
    const category = document.createElement("span");
    category.textContent = channel.categoryName || "بدون فئة";
    meta.append(category);
    copy.append(name, meta);
    button.append(logo, copy);
    button.addEventListener("click", () => selectChannel(channel, button));
    return button;
  }

  function findRecommendedChannel() {
    return pickArBeinSports1Sd(channels);
  }

  function arBeinSportsSdCategoryId() {
    const match = categories.find((category) => isArBeinSportsSdCategory(category.name));
    return match?.categoryId ? String(match.categoryId) : "";
  }

  function highlightRecommended() {
    const ch = findRecommendedChannel();
    if (!ch) return;
    const card = channelGrid.querySelector(`[data-stream-id="${ch.streamId}"]`);
    if (card) card.classList.add("recommended");
  }

  function renderChannels() {
    channelGrid.replaceChildren();
    resultCount.textContent = `${channels.length} قناة`;
    if (!channels.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "لا توجد قنوات مطابقة. اختر فئة رياضية أو ابحث باسم القناة.";
      channelGrid.appendChild(empty);
      return;
    }
    channels.forEach((channel) => channelGrid.appendChild(channelCard(channel)));
    highlightRecommended();
  }

  async function loadChannels() {
    if (loadController) loadController.abort();
    loadController = new AbortController();
    setError("");
    resultCount.textContent = "جارٍ البحث…";
    channelGrid.innerHTML = '<div class="empty">جارٍ تحميل القنوات…</div>';
    const params = new URLSearchParams({ limit: "80" });
    const query = searchInput.value.trim();
    const category = categorySelect.value;
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    try {
      const data = await getJson(`/api/iptv-lab/live?${params}`, loadController.signal);
      channels = (data.portals || []).flatMap((block) => block.streams || []);
      renderChannels();
    } catch (error) {
      if (error.name === "AbortError") return;
      channels = [];
      renderChannels();
      setError(`تعذر تحميل القنوات: ${error.message || error}`);
    }
  }

  function setPlayingUi(playing) {
    playerBox.classList.toggle("is-playing", Boolean(playing));
    playerEmpty.hidden = Boolean(playing);
    if (playerTools) playerTools.hidden = !playing;
  }

  function isFullscreen() {
    return Boolean(
      document.fullscreenElement
      || document.webkitFullscreenElement
      || video.webkitDisplayingFullscreen,
    );
  }

  function toggleFullscreen() {
    if (isFullscreen()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
      else if (video.webkitExitFullscreen) video.webkitExitFullscreen();
      return;
    }
    if (playerBox.requestFullscreen) {
      playerBox.requestFullscreen().catch(() => {
        if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      });
    } else if (playerBox.webkitRequestFullscreen) {
      playerBox.webkitRequestFullscreen();
    } else if (video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    }
  }

  function canPictureInPicture() {
    return Boolean(
      (document.pictureInPictureEnabled && video.requestPictureInPicture)
      || (video.webkitSupportsPresentationMode && typeof video.webkitSetPresentationMode === "function"),
    );
  }

  function togglePictureInPicture() {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
      return;
    }
    if (video.webkitSupportsPresentationMode && typeof video.webkitSetPresentationMode === "function") {
      const next = video.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture";
      video.webkitSetPresentationMode(next);
      return;
    }
    if (video.requestPictureInPicture) {
      video.requestPictureInPicture().catch(() => {});
    }
  }

  function clearReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function destroyPlayer() {
    clearReconnect();
    video.onended = null;
    if (hls) {
      try { hls.destroy(); } catch (_) { /* noop */ }
      hls = null;
    }
    releaseTsPlayer();
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  function playbackUrl(path) {
    try {
      return new URL(path, window.location.origin).toString();
    } catch {
      return path;
    }
  }

  function isHevcChannel(channel) {
    const text = `${channel?.name || ""} ${channel?.categoryName || ""}`;
    return /\bhevc\b/i.test(text) || /\bh\.?265\b/i.test(text);
  }

  function releaseTsPlayer() {
    if (!mpegTsPlayer) return;
    try {
      mpegTsPlayer.pause();
      mpegTsPlayer.unload();
      mpegTsPlayer.detachMediaElement();
      mpegTsPlayer.destroy();
    } catch (_) { /* noop */ }
    mpegTsPlayer = null;
  }

  function playChannel(channel) {
    playbackGeneration += 1;
    const generation = playbackGeneration;
    destroyPlayer();
    setPlayingUi(true);
    if (pipBtn) pipBtn.hidden = !canPictureInPicture();
    playerState.textContent = "جارٍ التحميل";
    let usingHls = false;
    let hlsRecoveries = 0;
    let tsStartupFailures = 0;
    let tsEverPlayed = false;
    let tsRuntimeHlsAttempted = false;
    let hlsFallbackFromTs = false;
    let hlsReturnedToTs = false;
    const hevc = isHevcChannel(channel);
    const onPlaying = () => {
      if (generation !== playbackGeneration) return;
      if (!usingHls) tsEverPlayed = true;
      playerState.textContent = usingHls ? "يعمل · HLS" : "يعمل · MPEG-TS";
    };
    video.addEventListener("playing", onPlaying);
    const onError = () => {
      if (generation !== playbackGeneration) return;
      if (usingHls && hlsFallbackFromTs && !hlsReturnedToTs) {
        hlsReturnedToTs = true;
        hlsFallbackFromTs = false;
        playerState.textContent = "HLS غير متاح · العودة إلى MPEG-TS";
        clearReconnect();
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          playTs();
        }, 500);
        return;
      }
      playerState.textContent = hevc
        ? "HEVC غير مدعوم هنا · استخدم BEIN SD"
        : "تعذر التشغيل";
    };
    const hlsUrl = playbackUrl(channel.playbackUrl);
    const tsUrl = playbackUrl(channel.tsPlaybackUrl);

    const playHls = () => {
      if (generation !== playbackGeneration) return;
      clearReconnect();
      usingHls = true;
      video.onended = null;
      releaseTsPlayer();
      video.pause();
      video.removeAttribute("src");
      video.load();
      playerState.textContent = hevc ? "HEVC · HLS" : hlsFallbackFromTs ? "الانتقال إلى HLS المستمر…" : "جارٍ تجربة HLS";
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = hlsUrl;
        video.addEventListener("error", onError, { once: true });
        const attempt = video.play();
        if (attempt?.catch) attempt.catch(() => { playerState.textContent = "اضغط تشغيل"; });
        return;
      }
      if (!(window.Hls && window.Hls.isSupported())) {
        onError();
        return;
      }
      hls = new window.Hls({
        enableWorker: true,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
        liveSyncDurationCount: 3,
      });
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        if (!hevc && data.type === window.Hls.ErrorTypes.MEDIA_ERROR && hlsRecoveries < 1) {
          hlsRecoveries += 1;
          try { hls.recoverMediaError(); return; } catch (_) { /* give up */ }
        }
        onError();
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      const attempt = video.play();
      if (attempt?.catch) attempt.catch(() => { playerState.textContent = "اضغط تشغيل"; });
    };

    const playTs = () => {
      if (generation !== playbackGeneration) return;
      clearReconnect();
      usingHls = false;
      releaseTsPlayer();
      video.pause();
      video.removeAttribute("src");
      video.load();
      playerState.textContent = tsEverPlayed ? "إعادة وصل MPEG-TS…" : "جارٍ تشغيل MPEG-TS";

      const scheduleReconnect = (type, detail) => {
        if (generation !== playbackGeneration || reconnectTimer) return;
        releaseTsPlayer();
        if (!tsEverPlayed) tsStartupFailures += 1;
        if (!tsEverPlayed && tsStartupFailures > 3) {
          playerState.textContent = "MPEG-TS لم يبدأ · تجربة HLS";
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            playHls();
          }, 900);
          return;
        }
        if (tsEverPlayed && channel.playbackUrl && !tsRuntimeHlsAttempted) {
          tsRuntimeHlsAttempted = true;
          hlsFallbackFromTs = true;
          playerState.textContent = "انتهت دفعة MPEG-TS · الانتقال إلى HLS المستمر…";
          console.warn("IPTV Lab finite MPEG-TS burst; trying HLS", type || "ended", detail || "");
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            playHls();
          }, 180);
          return;
        }
        const delay = tsEverPlayed ? 700 : Math.min(800 * tsStartupFailures, 2400);
        playerState.textContent = tsEverPlayed
          ? "انقطع اتصال MPEG-TS مؤقتاً · إعادة الوصل…"
          : "تعذر بدء MPEG-TS · إعادة المحاولة…";
        console.warn("IPTV Lab MPEG-TS reconnect", type || "ended", detail || "");
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          playTs();
        }, delay);
      };

      mpegTsPlayer = window.mpegts.createPlayer(
        { type: "mpegts", isLive: true, url: tsUrl },
        {
          enableWorker: false,
          enableStashBuffer: false,
          stashInitialSize: 128,
        },
      );
      mpegTsPlayer.attachMediaElement(video);
      mpegTsPlayer.on(window.mpegts.Events.ERROR, (type, detail, info) => {
        console.warn("IPTV Lab MPEG-TS playback error", type, detail, info || "");
        scheduleReconnect(type, detail);
      });
      video.onended = () => scheduleReconnect("ended", "media element ended");
      mpegTsPlayer.load();
      const attempt = mpegTsPlayer.play();
      if (attempt?.catch) attempt.catch(() => { playerState.textContent = "اضغط تشغيل"; });
    };

    if (!hevc && channel.tsPlaybackUrl && window.mpegts?.isSupported()) {
      playTs();
      return;
    }
    playHls();
  }

  function selectChannel(channel, button) {
    channelGrid.querySelectorAll(".channel.active").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    selectedName.textContent = channel.name;
    selectedMeta.textContent = `${channel.categoryName || "بدون فئة"} · Stream ${channel.streamId}`;
    selectedMetaChip.textContent = "تشغيل داخل المختبر";
    playChannel(channel);
  }

  fsBtn?.addEventListener("click", toggleFullscreen);
  pipBtn?.addEventListener("click", togglePictureInPicture);
  document.addEventListener("fullscreenchange", () => {
    if (fsBtn) fsBtn.textContent = isFullscreen() ? "⤢ إغلاق ملء الشاشة" : "⛶ ملء الشاشة";
  });
  document.addEventListener("webkitfullscreenchange", () => {
    if (fsBtn) fsBtn.textContent = isFullscreen() ? "⤢ إغلاق ملء الشاشة" : "⛶ ملء الشاشة";
  });
  video.addEventListener("webkitbeginfullscreen", () => {
    if (fsBtn) fsBtn.textContent = "⤢ إغلاق ملء الشاشة";
  });
  video.addEventListener("webkitendfullscreen", () => {
    if (fsBtn) fsBtn.textContent = "⛶ ملء الشاشة";
  });

  recBtn.addEventListener("click", async () => {
    recBtn.disabled = true;
    recBtn.textContent = "جارٍ البحث…";
    try {
      let ch = findRecommendedChannel();
      if (!ch) {
        searchInput.value = "bein sports 1 sd";
        categorySelect.value = arBeinSportsSdCategoryId();
        await loadChannels();
        ch = findRecommendedChannel();
      }
      if (!ch) {
        searchInput.value = "bein sports 1 sd";
        categorySelect.value = "";
        await loadChannels();
        ch = findRecommendedChannel();
      }
      if (!ch) {
        setError("لم تُعثر على قناة AR BEIN SPORTS 1 SD في البيانات المتاحة.");
        return;
      }
      const card = channelGrid.querySelector(`[data-stream-id="${ch.streamId}"]`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        selectChannel(ch, card);
      }
    } catch (err) {
      setError(`تعذر تحميل القناة المقترحة: ${err.message || err}`);
    } finally {
      recBtn.textContent = REC_DEFAULT_LABEL;
      recBtn.disabled = false;
    }
  });

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadChannels();
  });
  categorySelect.addEventListener("change", loadChannels);
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    try {
      await Promise.all([loadStatus(), loadCategories()]);
      await loadChannels();
    } catch (error) {
      setError(error.message || String(error));
    } finally {
      refreshBtn.disabled = false;
    }
  });

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      await Promise.all([loadStatus(), loadCategories()]);
      await loadChannels();
    } catch (error) {
      setError(`تعذر بدء المختبر: ${error.message || error}`);
      resultCount.textContent = "خطأ";
    }
  });
})();
