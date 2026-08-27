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
  const playerEmpty = document.getElementById("playerEmpty");
  const playerState = document.getElementById("playerState");
  const selectedName = document.getElementById("selectedName");
  const selectedMeta = document.getElementById("selectedMeta");
  const selectedMetaChip = document.getElementById("selectedMetaChip");

  const SPORT_RE = /bein|sport|dazn|espn|sky|ssn|tnt|premiere|liga|football/i;

  let categories = [];
  let channels = [];
  let hls = null;
  let mpegTsPlayer = null;
  let loadController = null;

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
    const scored = categories
      .map((category) => ({
        category,
        score: /bein/i.test(category.name) ? 3 : SPORT_RE.test(category.name) ? 2 : 0,
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

  function destroyPlayer() {
    if (hls) {
      try { hls.destroy(); } catch (_) { /* noop */ }
      hls = null;
    }
    if (mpegTsPlayer) {
      try {
        mpegTsPlayer.pause();
        mpegTsPlayer.unload();
        mpegTsPlayer.detachMediaElement();
        mpegTsPlayer.destroy();
      } catch (_) { /* noop */ }
      mpegTsPlayer = null;
    }
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  function playChannel(channel) {
    destroyPlayer();
    playerEmpty.hidden = true;
    playerState.textContent = "جارٍ التحميل";
    let usingTsFallback = false;
    const onPlaying = () => { playerState.textContent = usingTsFallback ? "يعمل · TS" : "يعمل · HLS"; };
    const onError = () => { playerState.textContent = "تعذر التشغيل"; };

    const playTsFallback = () => {
      if (usingTsFallback || !channel.tsPlaybackUrl || !window.mpegts?.isSupported()) {
        onError();
        return;
      }
      usingTsFallback = true;
      if (hls) {
        try { hls.destroy(); } catch (_) { /* noop */ }
        hls = null;
      }
      video.pause();
      video.removeAttribute("src");
      video.load();
      playerState.textContent = "جارٍ تجربة TS";
      mpegTsPlayer = window.mpegts.createPlayer(
        { type: "mpegts", isLive: true, url: channel.tsPlaybackUrl },
        { enableWorker: true, enableStashBuffer: false, stashInitialSize: 128 },
      );
      mpegTsPlayer.attachMediaElement(video);
      mpegTsPlayer.on(window.mpegts.Events.ERROR, onError);
      mpegTsPlayer.load();
      const attempt = mpegTsPlayer.play();
      if (attempt?.catch) attempt.catch(() => { playerState.textContent = "اضغط تشغيل"; });
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = channel.playbackUrl;
      video.addEventListener("error", playTsFallback, { once: true });
    } else if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({
        enableWorker: true,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
        liveSyncDurationCount: 3,
      });
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          try { hls.recoverMediaError(); return; } catch (_) { /* use TS below */ }
        }
        playTsFallback();
      });
      hls.loadSource(channel.playbackUrl);
      hls.attachMedia(video);
    } else {
      playTsFallback();
      return;
    }
    video.addEventListener("playing", onPlaying, { once: true });
    const attempt = video.play();
    if (attempt?.catch) attempt.catch(() => { playerState.textContent = "اضغط تشغيل"; });
  }

  function selectChannel(channel, button) {
    channelGrid.querySelectorAll(".channel.active").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    selectedName.textContent = channel.name;
    selectedMeta.textContent = `${channel.categoryName || "بدون فئة"} · Stream ${channel.streamId}`;
    selectedMetaChip.textContent = "تشغيل داخل المختبر";
    playChannel(channel);
  }

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
