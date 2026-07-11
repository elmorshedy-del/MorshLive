(() => {
  "use strict";

  const statusEl = document.getElementById("portalStatus");
  const portalSelect = document.getElementById("portalSelect");
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
  const selectedPortal = document.getElementById("selectedPortal");
  const openWatchBtn = document.getElementById("openWatchBtn");
  const reloadPreviewBtn = document.getElementById("reloadPreviewBtn");

  let categories = [];
  let channels = [];
  let selected = null;
  let hls = null;
  let loadController = null;

  function setError(message) {
    errorBox.hidden = !message;
    errorBox.textContent = message || "";
  }

  async function getJson(url) {
    const response = await fetch(url, { cache: "no-store" });
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

  async function loadStatus() {
    const data = await getJson("/api/xtream/status");
    statusEl.replaceChildren();
    portalSelect.replaceChildren();
    addOption(portalSelect, "", "كل البوابات");
    data.portals.forEach((portal) => {
      const chip = document.createElement("span");
      chip.className = `status-chip ${portal.ok ? "ok" : "down"}`;
      chip.textContent = `${portal.label}: ${portal.ok ? portal.account?.status || "متصل" : "غير متاح"}`;
      statusEl.appendChild(chip);
      if (portal.ok) addOption(portalSelect, portal.id, portal.label);
    });
  }

  async function loadCategories() {
    const data = await getJson("/api/xtream/categories");
    categories = data.portals.flatMap((block) => block.categories || []);
    renderCategoryOptions();
  }

  function renderCategoryOptions() {
    const selectedValue = categorySelect.value;
    const portalId = portalSelect.value;
    categorySelect.replaceChildren();
    addOption(categorySelect, "", "كل الفئات");
    const seen = new Set();
    categories
      .filter((category) => !portalId || category.portalId === portalId)
      .sort((a, b) => a.name.localeCompare(b.name, "ar"))
      .forEach((category) => {
        const key = `${category.portalId}:${category.categoryId}`;
        if (seen.has(key)) return;
        seen.add(key);
        addOption(categorySelect, category.categoryId, `${category.name} — ${category.portalLabel}`);
      });
    if ([...categorySelect.options].some((option) => option.value === selectedValue)) {
      categorySelect.value = selectedValue;
    }
  }

  function channelInitial(name) {
    const words = String(name || "TV").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "TV";
  }

  function channelCard(channel) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "channel";
    button.dataset.key = `${channel.portalId}:${channel.streamId}`;

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
    const portal = document.createElement("span");
    portal.textContent = channel.portalLabel;
    const category = document.createElement("span");
    category.textContent = channel.categoryName || "بدون فئة";
    meta.append(portal, category);
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
      empty.textContent = "لا توجد قنوات مطابقة. جرّب اسماً أو فئة أخرى.";
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
    const params = new URLSearchParams({ limit: "120" });
    if (searchInput.value.trim()) params.set("q", searchInput.value.trim());
    if (portalSelect.value) params.set("portal", portalSelect.value);
    if (categorySelect.value) params.set("category", categorySelect.value);
    try {
      const response = await fetch(`/api/xtream/live?${params}`, { cache: "no-store", signal: loadController.signal });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
      channels = data.portals.flatMap((block) => block.streams || []);
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
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  function playChannel(channel) {
    destroyPlayer();
    playerEmpty.hidden = true;
    playerState.textContent = "جارٍ التحميل";
    const onPlaying = () => { playerState.textContent = "يعمل"; };
    const onError = () => { playerState.textContent = "تعذر التشغيل"; };
    video.addEventListener("playing", onPlaying, { once: true });
    video.addEventListener("error", onError, { once: true });

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = channel.playbackUrl;
    } else if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({
        enableWorker: true,
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 5,
        liveSyncDurationCount: 3,
      });
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          try { hls.startLoad(); } catch (_) { onError(); }
        } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          try { hls.recoverMediaError(); } catch (_) { onError(); }
        } else {
          onError();
        }
      });
      hls.loadSource(channel.playbackUrl);
      hls.attachMedia(video);
    } else {
      video.src = channel.playbackUrl;
    }
    const attempt = video.play();
    if (attempt?.catch) attempt.catch(() => { playerState.textContent = "اضغط تشغيل"; });
  }

  function selectChannel(channel, button) {
    selected = channel;
    channelGrid.querySelectorAll(".channel.active").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    selectedName.textContent = channel.name;
    selectedMeta.textContent = `${channel.portalLabel} · ${channel.categoryName || "بدون فئة"} · Stream ${channel.streamId}`;
    selectedPortal.textContent = channel.portalLabel;
    openWatchBtn.disabled = false;
    reloadPreviewBtn.disabled = false;
    playChannel(channel);
  }

  async function refreshSelected() {
    if (!selected) return;
    playerState.textContent = "جارٍ تحديث الرابط";
    try {
      const params = new URLSearchParams({ portal: selected.portalId, stream: String(selected.streamId), limit: "1" });
      const data = await getJson(`/api/xtream/live?${params}`);
      const fresh = data.portals.flatMap((block) => block.streams || [])[0];
      if (!fresh) throw new Error("القناة غير متاحة حالياً");
      selected = fresh;
      playChannel(fresh);
    } catch (error) {
      playerState.textContent = "تعذر التحديث";
      setError(error.message || String(error));
    }
  }

  function openInWatchPage() {
    if (!selected) return;
    const imported = {
      portalId: selected.portalId,
      portalLabel: selected.portalLabel,
      streamId: selected.streamId,
      name: selected.name,
      categoryName: selected.categoryName || "",
      icon: selected.icon || "",
      savedAt: Date.now(),
    };
    try { localStorage.setItem("kz_xtream_selected", JSON.stringify(imported)); } catch (_) { /* noop */ }
    const params = new URLSearchParams({
      source: "xtream",
      portal: selected.portalId,
      stream: String(selected.streamId),
      name: selected.name,
    });
    if (selected.categoryName) params.set("category", selected.categoryName);
    location.href = `watch.html?${params}`;
  }

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadChannels();
  });
  portalSelect.addEventListener("change", () => {
    renderCategoryOptions();
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
  reloadPreviewBtn.addEventListener("click", refreshSelected);
  openWatchBtn.addEventListener("click", openInWatchPage);

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      await Promise.all([loadStatus(), loadCategories()]);
      await loadChannels();
    } catch (error) {
      setError(`تعذر بدء لوحة IPTV: ${error.message || error}`);
      resultCount.textContent = "خطأ";
    }
  });
})();
