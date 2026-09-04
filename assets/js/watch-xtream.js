/* Dedicated Xtream/IPTV watch path.
 *
 * This player intentionally bypasses match routing and the full IPTV catalog.
 * It probes the selected stream first, then mounts the protocol that actually
 * works. In particular, a provider URL ending in .m3u8 is NOT assumed to be
 * HLS when the probe says the payload is MPEG-TS.
 */
(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const portal = String(params.get("portal") || "").replace(/[^a-z0-9_-]/gi, "");
  const stream = String(params.get("stream") || "").replace(/[^0-9]/g, "");
  const premium = params.get("premium") === "1";
  const shell = document.getElementById("player-shell");
  const toolbar = document.getElementById("player-toolbar");
  const state = { mpegts: null, hls: null, watchdog: 0, reconnect: 0, loading: false, generation: 0 };

  window.__KZ_WATCH_IMPL = "xtream";

  function t(key, fallback) {
    try {
      const value = window.I18N?.t?.(key);
      return value && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
    ));
  }

  async function getJson(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  function stopPlayer() {
    clearTimeout(state.watchdog);
    clearTimeout(state.reconnect);
    state.watchdog = 0;
    state.reconnect = 0;
    if (state.hls) {
      const player = state.hls;
      state.hls = null;
      try { player.destroy(); } catch {}
    }
    if (state.mpegts) {
      const player = state.mpegts;
      state.mpegts = null;
      try {
        player.pause();
        player.unload();
        player.detachMediaElement();
        player.destroy();
      } catch {}
    }
  }

  function showMessage(message, kind = "loading") {
    if (!shell) return;
    stopPlayer();
    shell.innerHTML = `<div class="manual-mirror-error" data-xtream-state="${escapeHtml(kind)}">${escapeHtml(message)}</div>`;
  }

  function originalHref() {
    const url = new URL(location.href);
    ["source", "portal", "stream", "direct", "premium", "premiumChannelId", "protocol"].forEach((key) => {
      url.searchParams.delete(key);
    });
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function installToolbar(channel, probe) {
    if (!toolbar) return;
    const channelId = params.get("premiumChannelId") || params.get("ch") || channel?.name || "القناة";
    const protocol = String(probe?.protocol || "").toUpperCase();
    toolbar.innerHTML = `
      <div class="watch-source-toggle iptv-premium-test-toggle" role="group" aria-label="${escapeHtml(t("watch.sourceTabsAria", "Watch source"))}">
        <span class="watch-source-toggle__kicker">${escapeHtml(t("watch.sourceToggle", "Source"))}</span>
        <div class="watch-source-toggle__track">
          <a class="watch-source-toggle__opt watch-source-toggle__opt--premium is-active" aria-selected="true" href="${escapeHtml(location.pathname + location.search)}">
            <span>${escapeHtml(t("card.watchPremium", "مشاهدة مميزة"))}</span>
            <small>${escapeHtml(channelId)}${protocol ? ` · ${escapeHtml(protocol)}` : ""}</small>
          </a>
          <a class="watch-source-toggle__opt watch-source-toggle__opt--original" aria-selected="false" href="${escapeHtml(originalHref())}">
            <span>${escapeHtml(t("card.watchOriginal", "Original stream"))}</span>
          </a>
        </div>
      </div>
      <button type="button" class="player-reload-btn js-stream-reload" aria-label="${escapeHtml(t("watch.reload", "Reload"))}">
        <svg class="ico reload-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.3"/><polyline points="21 4 21 10 15 10"/></svg>
        <span>${escapeHtml(t("watch.reload", "Reload"))}</span>
      </button>`;
    toolbar.querySelector(".js-stream-reload")?.addEventListener("click", () => load().catch(showLoadError));
  }

  function fillInfo(channel, probe) {
    const name = channel?.name || params.get("name") || "القناة";
    const category = channel?.categoryName || params.get("category") || "بث مباشر";
    const portalLabel = channel?.portalLabel || portal || "KoraZero";
    const protocol = String(probe?.protocol || "").toUpperCase() || "مباشر";
    const setText = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    };
    setText("ch-name", name);
    const status = document.getElementById("ch-status");
    if (status) status.innerHTML = '<span class="status-pill status-live">مباشر</span>';
    setText("now-sub", `${portalLabel} · ${category}`);
    setText("info-quality", probe?.codecs?.video ? String(probe.codecs.video).toUpperCase() : "Live");
    setText("info-group", category);
    setText("info-route", `${protocol} · ${portalLabel}`);
    setText("info-commentator", "—");
    setText("info-league", category);
    setText("info-times", "—");
    document.title = `${name} — KoraZero`;

    const sourceCard = document.querySelector(".watch-sources-card");
    if (sourceCard) sourceCard.hidden = true;
    const alt = document.getElementById("alt-streams");
    if (alt) alt.hidden = true;
    const mirrors = document.getElementById("manual-mirrors");
    if (mirrors) mirrors.hidden = true;
    const sidebar = document.getElementById("side-channels");
    if (sidebar) sidebar.innerHTML = "";
  }

  function makeVideo() {
    if (!shell) throw new Error("Player shell is unavailable");
    stopPlayer();
    shell.innerHTML = '<video class="kz-main-video" controls autoplay muted playsinline webkit-playsinline></video>';
    const video = shell.querySelector("video");
    if (!video) throw new Error("Video element could not be created");
    video.dataset.xtreamPremium = premium ? "1" : "0";
    return video;
  }

  function armPlaybackWatchdog(video, protocol) {
    clearTimeout(state.watchdog);
    const markPlaying = () => {
      video.dataset.playbackStarted = "1";
      clearTimeout(state.watchdog);
      state.watchdog = 0;
    };
    video.addEventListener("playing", markPlaying, { once: true });
    video.addEventListener("loadeddata", () => {
      if (video.readyState >= 2) video.dataset.mediaLoaded = "1";
    }, { once: true });
    state.watchdog = setTimeout(() => {
      if (video.dataset.playbackStarted === "1" || video.readyState >= 2) return;
      stopPlayer();
      if (shell) {
        shell.innerHTML = `<div class="manual-mirror-error" data-xtream-state="timeout">تعذر بدء بث ${escapeHtml(protocol)} بدون توقف الصفحة. جرّب إعادة التحميل أو البث الأصلي.</div>`;
      }
    }, 20000);
  }

  function scheduleTsReconnect(channel, generation, reason) {
    if (generation !== state.generation || state.reconnect) return;
    console.warn("Xtream TS reconnect", reason || "stream ended");
    stopPlayer();
    if (generation !== state.generation) return;
    if (shell) {
      shell.innerHTML = '<div class="manual-mirror-error" data-xtream-state="reconnecting">انقطع البث لحظياً · جارٍ إعادة الاتصال…</div>';
    }
    state.reconnect = setTimeout(() => {
      state.reconnect = 0;
      if (generation !== state.generation) return;
      try {
        mountTs(channel, generation);
      } catch (error) {
        showLoadError(error);
      }
    }, 700);
  }

  function mountTs(channel, generation = state.generation) {
    const tsUrl = channel?.tsPlaybackUrl || channel?.directTsPlaybackUrl;
    if (!tsUrl) throw new Error("TS playback URL is unavailable");
    if (!window.mpegts?.isSupported?.()) {
      throw new Error("هذا المتصفح لا يدعم تشغيل MPEG-TS عبر Media Source");
    }
    const video = makeVideo();
    state.mpegts = window.mpegts.createPlayer(
      { type: "mpegts", isLive: true, url: tsUrl },
      {
        enableWorker: false,
        enableWorkerForMSE: false,
        enableStashBuffer: true,
        stashInitialSize: 384 * 1024,
        liveSync: true,
      },
    );
    state.mpegts.attachMediaElement(video);
    state.mpegts.on(window.mpegts.Events.ERROR, (type, detail, info) => {
      console.warn("Xtream TS playback error", type, detail, info || "");
      scheduleTsReconnect(channel, generation, `${type || "error"}:${detail || ""}`);
    });
    video.addEventListener("ended", () => {
      scheduleTsReconnect(channel, generation, "media element ended");
    }, { once: true });
    state.mpegts.load();
    const attempt = state.mpegts.play();
    if (attempt?.catch) attempt.catch(() => {});
    armPlaybackWatchdog(video, "TS");
    video.dataset.xtreamProtocol = "ts";
  }

  function mountHls(channel) {
    const hlsUrl = channel?.playbackUrl || channel?.directPlaybackUrl;
    if (!hlsUrl) throw new Error("HLS playback URL is unavailable");
    const video = makeVideo();
    const fatal = () => {
      stopPlayer();
      if (shell) shell.innerHTML = '<div class="manual-mirror-error" data-xtream-state="error">تعذر تشغيل HLS.</div>';
    };
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      video.addEventListener("error", fatal, { once: true });
    } else if (window.Hls?.isSupported?.()) {
      state.hls = new window.Hls({ enableWorker: true, liveSyncDurationCount: 3 });
      state.hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) fatal();
      });
      state.hls.loadSource(hlsUrl);
      state.hls.attachMedia(video);
    } else {
      throw new Error("هذا المتصفح لا يدعم HLS");
    }
    const attempt = video.play();
    if (attempt?.catch) attempt.catch(() => {});
    armPlaybackWatchdog(video, "HLS");
    video.dataset.xtreamProtocol = "hls";
  }

  async function fetchChannelAndProbe() {
    if (!portal || !stream) throw new Error("بيانات القناة غير مكتملة");
    const liveQuery = new URLSearchParams({ portal, stream, limit: "1" });
    const probeQuery = new URLSearchParams({ portal, stream });
    const [live, probe] = await Promise.all([
      getJson(`/api/xtream/live?${liveQuery}`),
      getJson(`/api/xtream/probe?${probeQuery}`),
    ]);
    const channel = (live.portals || []).flatMap((block) => block.streams || [])[0];
    if (!channel) throw new Error("القناة غير متاحة حالياً");
    if (!probe?.playable) throw new Error("القناة لا ترسل فيديو صالحاً حالياً");
    return { channel, probe };
  }

  function showLoadError(error) {
    console.error("Xtream premium player failed", error);
    showMessage(error?.message || String(error || "تعذر تشغيل القناة"), "error");
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    const generation = ++state.generation;
    showMessage("جارٍ فحص القناة وتجهيز البث…", "loading");
    try {
      const { channel, probe } = await fetchChannelAndProbe();
      if (generation !== state.generation) return;
      installToolbar(channel, probe);
      fillInfo(channel, probe);
      if (probe.protocol === "ts") mountTs(channel, generation);
      else if (probe.protocol === "hls") mountHls(channel);
      else throw new Error(`بروتوكول غير مدعوم: ${probe.protocol || "unknown"}`);
    } finally {
      state.loading = false;
    }
  }

  function initNav() {
    const toggle = document.querySelector(".nav-toggle");
    const links = document.querySelector(".nav-links");
    if (toggle && links) toggle.addEventListener("click", () => links.classList.toggle("open"));
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.body.classList.remove("match-plan-chrome");
    document.body.classList.add("xtream-chrome");
    initNav();
    load().catch(showLoadError);
  }, { once: true });

  window.addEventListener("pagehide", () => {
    state.generation += 1;
    stopPlayer();
  }, { once: true });
})();
