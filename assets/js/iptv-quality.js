(() => {
  "use strict";

  const video = document.getElementById("previewVideo");
  const channelGrid = document.getElementById("channelGrid");
  const playerState = document.getElementById("playerState");
  const codecEl = document.getElementById("qualityCodec");
  const compatibilityEl = document.getElementById("qualityCompatibility");
  const resolutionEl = document.getElementById("qualityResolution");
  const labelEl = document.getElementById("qualityLabel");
  const fpsEl = document.getElementById("qualityFps");
  const protocolEl = document.getElementById("qualityProtocol");
  const framesEl = document.getElementById("qualityFrames");
  const browserEl = document.getElementById("qualityBrowser");
  const noteEl = document.getElementById("qualityNote");

  if (!video || !channelGrid || !compatibilityEl) return;

  const nativeHls = Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
  const hlsJs = Boolean(window.Hls && window.Hls.isSupported?.());
  const mpegTs = Boolean(window.mpegts && window.mpegts.isSupported?.());
  const hevc = Boolean(
    video.canPlayType('video/mp4; codecs="hvc1"')
    || video.canPlayType('video/mp4; codecs="hev1"'),
  );

  let activeStreamId = "";
  let frameTimer = null;
  // What the player is actually using. The /probe call reports which protocol
  // the *source* answers on, which is a different question and lands seconds
  // later — it must never overwrite the live answer.
  let playbackProtocol = "";

  function setPlaybackProtocol(value, tone = "good") {
    playbackProtocol = value;
    setValue(protocolEl, value, tone);
  }

  function setValue(el, value, tone = "") {
    if (!el) return;
    el.textContent = value;
    el.classList.remove("good", "warn", "bad");
    if (tone) el.classList.add(tone);
  }

  function browserSummary() {
    // Name the path the lab will actually take first, so a stutter or a black
    // frame can be attributed without opening the console.
    const primary = nativeHls ? "المسار: HLS أصلي" : mpegTs ? "المسار: MPEG-TS" : "المسار: HLS.js";
    return `${primary} · ${hevc ? "HEVC معلن ✓" : "HEVC غير معلن ?"} · ${nativeHls ? "HLS أصلي ✓" : hlsJs ? "HLS.js ✓" : "HLS ✕"} · ${mpegTs ? "TS ✓" : "TS ✕"}`;
  }

  function codecName(value) {
    const codec = String(value || "").toLowerCase();
    if (codec === "hevc" || codec === "h265") return "HEVC / H.265";
    if (codec === "h264") return "H.264 / AVC";
    return codec ? codec.toUpperCase() : "غير معروف";
  }

  function audioName(value) {
    const codec = String(value || "").toLowerCase();
    if (codec === "aac") return "AAC";
    if (codec === "ac3") return "AC-3";
    if (codec === "mp2") return "MP2";
    return codec ? codec.toUpperCase() : "";
  }

  function qualityLabel(width, height) {
    const h = Number(height) || 0;
    const w = Number(width) || 0;
    if (h >= 2160 || w >= 3840) return "4K / UHD";
    if (h >= 1440 || w >= 2560) return "1440p / QHD";
    if (h >= 1080 || w >= 1920) return "1080p / Full HD";
    if (h >= 720 || w >= 1280) return "720p / HD";
    if (h >= 480) return `${h}p / SD`;
    return h ? `${h}p` : "بانتظار الفيديو";
  }

  function updateVideoMetrics() {
    const width = Number(video.videoWidth) || 0;
    const height = Number(video.videoHeight) || 0;
    if (!width || !height) return false;
    setValue(resolutionEl, `${width} × ${height}`, "good");
    setValue(labelEl, qualityLabel(width, height), height >= 720 ? "good" : "warn");
    return true;
  }

  function stopFrames() {
    if (frameTimer) clearInterval(frameTimer);
    frameTimer = null;
  }

  function startFrames() {
    stopFrames();
    if (typeof video.getVideoPlaybackQuality !== "function") return;
    let last = Number(video.getVideoPlaybackQuality().totalVideoFrames) || 0;
    let lastAt = performance.now();
    frameTimer = setInterval(() => {
      const now = performance.now();
      const stats = video.getVideoPlaybackQuality();
      const total = Number(stats.totalVideoFrames) || 0;
      const dropped = Number(stats.droppedVideoFrames) || 0;
      const elapsed = now - lastAt;
      if (elapsed > 0 && total >= last) {
        const fps = ((total - last) * 1000) / elapsed;
        setValue(fpsEl, `${fps.toFixed(fps >= 10 ? 1 : 2)} FPS`, fps >= 20 ? "good" : "warn");
      }
      if (total) {
        const pct = (dropped / total) * 100;
        setValue(framesEl, `${dropped}/${total} (${pct.toFixed(1)}%)`, pct <= 1 ? "good" : pct <= 5 ? "warn" : "bad");
      }
      last = total;
      lastAt = now;
    }, 2000);
  }

  // /api/iptv-lab/probe opens a real `/live/...` request. The lab line is
  // provisioned with max_connections: 1, and a probe fired while a channel is
  // playing makes the panel close the player's stream within a few seconds and
  // then hold the slot as a ghost session — the buffer drains to zero and the
  // picture stalls. So the probe is never automatic any more: it runs only once
  // playback has given up, or when the operator asks for it. One shared,
  // deduplicated promise per stream serves every caller on the page.
  const probeCache = new Map();

  function requestProbe(streamId) {
    const key = String(streamId);
    if (!probeCache.has(key)) {
      probeCache.set(
        key,
        fetch(`/api/iptv-lab/probe?stream=${encodeURIComponent(key)}`, { cache: "no-store" })
          .then(async (response) => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.ok === false) {
              throw new Error(data.error || `HTTP ${response.status}`);
            }
            return data;
          })
          .catch((error) => {
            probeCache.delete(key);
            throw error;
          }),
      );
    }
    return probeCache.get(key);
  }

  function renderProbe(streamId, data) {
    if (String(streamId) !== activeStreamId) return;
    const codecs = data.codecs || {};
    const audio = audioName(codecs.audio);
    setValue(
      codecEl,
      `${codecName(codecs.video)}${audio ? ` · ${audio}` : ""} (المصدر)`,
      data.playable ? "good" : "warn",
    );
    if (data.protocol && !playbackProtocol) {
      setValue(protocolEl, `${String(data.protocol).toUpperCase()} (المصدر)`);
    }
    if (!data.playable) {
      setValue(compatibilityEl, "المصدر لا يرسل فيديو صالحاً الآن", "bad");
      return;
    }
    setValue(
      compatibilityEl,
      data.mobileCompatible
        ? "المصدر سليم — الفشل في المتصفح وليس في القناة"
        : "المصدر يحتاج codec غير مدعوم هنا",
      data.mobileCompatible ? "warn" : "bad",
    );
  }

  async function probeNow(streamId) {
    const key = String(streamId);
    setValue(codecEl, "جارٍ فحص المصدر…");
    try {
      renderProbe(key, await requestProbe(key));
    } catch (error) {
      if (key !== activeStreamId) return;
      setValue(codecEl, "تعذر الفحص", "warn");
      if (noteEl) noteEl.textContent = `تعذر فحص المصدر: ${error.message || error}`;
    }
  }

  function syncActive() {
    const active = channelGrid.querySelector(".channel.active[data-stream-id]");
    const streamId = String(active?.dataset?.streamId || "");
    if (!streamId || streamId === activeStreamId) return;
    activeStreamId = streamId;
    playbackProtocol = "";
    setValue(codecEl, "بانتظار التشغيل…");
    setValue(compatibilityEl, "جارٍ التحقق…", "warn");
    setValue(resolutionEl, "—");
    setValue(labelEl, "—");
    setValue(fpsEl, "—");
    setValue(protocolEl, "—");
    setValue(framesEl, "—");
    if (noteEl) {
      noteEl.textContent =
        "القياس يأتي من المشغّل نفسه — لا يفتح اتصالاً إضافياً بالبوابة (الاشتراك اتصال واحد).";
    }
  }

  // Playback has stopped trying, so the only connection is free: now a probe
  // tells us whether the source or the browser is at fault.
  window.addEventListener("kz:iptv-playback-failed", () => {
    if (activeStreamId) probeNow(activeStreamId);
  });

  window.addEventListener("kz:iptv-media-info", (event) => {
    const info = event.detail || {};
    const audio = audioName(info.audioCodec);
    if (info.videoCodec) {
      setValue(codecEl, `${codecName(info.videoCodec)}${audio ? ` · ${audio}` : ""}`, "good");
    }
    if (info.fps) setValue(fpsEl, `${Number(info.fps).toFixed(1)} FPS`, info.fps >= 20 ? "good" : "warn");
    updateVideoMetrics();
  });

  new MutationObserver(syncActive).observe(channelGrid, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  // The player announces its protocol the moment a frame renders. Text
  // scraping stays only as a fallback for state strings the player sets
  // before playback starts (and never once the player has spoken).
  window.addEventListener("kz:iptv-protocol", (event) => {
    const protocol = String(event.detail?.protocol || "");
    if (protocol) setPlaybackProtocol(protocol);
  });

  if (playerState) {
    new MutationObserver(() => {
      if (playbackProtocol) return;
      const text = String(playerState.textContent || "");
      if (/\bMPEG-TS\b/i.test(text)) setValue(protocolEl, "MPEG-TS", "warn");
      else if (/HLS/i.test(text)) setValue(protocolEl, "HLS", "warn");
    }).observe(playerState, { childList: true, characterData: true, subtree: true });
  }

  video.addEventListener("loadedmetadata", updateVideoMetrics);
  video.addEventListener("resize", updateVideoMetrics);
  video.addEventListener("playing", () => {
    if (updateVideoMetrics()) {
      setValue(compatibilityEl, "✓ متوافق — تم فك الفيديو", "good");
      if (noteEl) noteEl.textContent = "نجح التشغيل الفعلي على هذا الجهاز.";
    }
    // Native HLS decodes inside the browser and reports no codec name. Say so
    // rather than leaving the field waiting forever on a channel that plays.
    if (codecEl && /^بانتظار/.test(String(codecEl.textContent || ""))) {
      setValue(codecEl, "يُفك داخل المتصفح · اضغط «افحص المصدر»", "good");
    }
    startFrames();
  });
  video.addEventListener("pause", stopFrames);
  video.addEventListener("ended", stopFrames);
  video.addEventListener("error", () => {
    stopFrames();
    if (!activeStreamId) return;
    setValue(compatibilityEl, "فشل المسار الأساسي · جارٍ انتظار مسار التوافق", "warn");
  });

  window.addEventListener("kz:iptv-compat-recovered", (event) => {
    if (String(event.detail?.streamId || "") !== activeStreamId) return;
    setValue(compatibilityEl, "✓ متوافق عبر مسار HLS البديل", "good");
    setPlaybackProtocol("HLS fallback");
    if (noteEl) noteEl.textContent = "فشل المسار الأساسي، لكن المختبر أعاد تشغيل القناة تلقائياً عبر مسار HLS المتوافق.";
  });

  window.addEventListener("kz:iptv-compat-unresolved", (event) => {
    if (String(event.detail?.streamId || "") !== activeStreamId) return;
    setValue(compatibilityEl, "✕ يحتاج Remux/Transcode على الخادم", "bad");
    if (noteEl) noteEl.textContent = "المصدر موجود، لكن كل مسارات المتصفح المتاحة فشلت. هذه الفئة تحتاج تحويل تغليف/codec على الخادم بدلاً من إخفائها من الكتالوج.";
  });

  // Explicit operator-driven probe. It costs the line's only connection, so it
  // pauses playback first rather than racing it.
  const probeBtn = document.getElementById("probeBtn");
  probeBtn?.addEventListener("click", async () => {
    if (!activeStreamId) return;
    probeBtn.disabled = true;
    try {
      video.pause();
      await probeNow(activeStreamId);
    } finally {
      probeBtn.disabled = false;
    }
  });

  // Shared with the compatibility fallback so the page never opens two probes.
  window.KZIptvLabProbe = { request: requestProbe };

  setValue(browserEl, browserSummary(), hevc ? "good" : "warn");

  const fallbackScript = document.createElement("script");
  fallbackScript.src = "assets/js/iptv-lab-compat-fallback.js?v=20260905probe1";
  fallbackScript.defer = true;
  document.head.appendChild(fallbackScript);
})();