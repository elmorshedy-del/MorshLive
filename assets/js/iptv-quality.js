(() => {
  "use strict";

  // Lab-only: restore the exact live MPEG-TS configuration proven by
  // Cursor Agent in commit 4f749717. The production watch player is not
  // affected because iptv-quality.js is loaded only by iptv-lab.html.
  const originalCreatePlayer = window.mpegts?.createPlayer?.bind(window.mpegts);
  if (originalCreatePlayer && !window.__KZ_CURSOR_TS_CONFIG) {
    window.__KZ_CURSOR_TS_CONFIG = true;
    window.mpegts.createPlayer = (mediaDataSource, config) => {
      if (mediaDataSource?.type === "mpegts" && mediaDataSource?.isLive) {
        return originalCreatePlayer(mediaDataSource, {
          enableWorker: false,
          enableStashBuffer: false,
          stashInitialSize: 128,
        });
      }
      return originalCreatePlayer(mediaDataSource, config);
    };
  }

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

  function setValue(el, value, tone = "") {
    if (!el) return;
    el.textContent = value;
    el.classList.remove("good", "warn", "bad");
    if (tone) el.classList.add(tone);
  }

  function browserSummary() {
    return `${hevc ? "HEVC معلن ✓" : "HEVC غير معلن ?"} · ${nativeHls ? "HLS أصلي ✓" : hlsJs ? "HLS.js ✓" : "HLS ✕"} · ${mpegTs ? "TS ✓" : "TS ✕"}`;
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

  async function probe(streamId) {
    try {
      const response = await fetch(`/api/iptv-lab/probe?stream=${encodeURIComponent(streamId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (String(streamId) !== activeStreamId) return;
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
      const codecs = data.codecs || {};
      const audio = audioName(codecs.audio);
      setValue(codecEl, `${codecName(codecs.video)}${audio ? ` · ${audio}` : ""}`, data.playable ? "good" : "warn");
      if (data.protocol) setValue(protocolEl, String(data.protocol).toUpperCase());
      if (!data.playable) {
        setValue(compatibilityEl, "فحص المصدر غير حاسم · التشغيل الفعلي هو الحكم", "warn");
        return;
      }
      if (data.mobileCompatible) {
        setValue(compatibilityEl, "توافق واسع متوقع · بانتظار التشغيل", "good");
      } else {
        setValue(compatibilityEl, "مسار توافق إضافي متاح إذا فشل التشغيل الأساسي", "warn");
      }
    } catch (error) {
      if (String(streamId) !== activeStreamId) return;
      setValue(codecEl, "تعذر الفحص", "warn");
      setValue(compatibilityEl, "التشغيل الفعلي سيحسم التوافق", "warn");
      if (noteEl) noteEl.textContent = `تعذر فحص المصدر: ${error.message || error}`;
    }
  }

  function syncActive() {
    const active = channelGrid.querySelector(".channel.active[data-stream-id]");
    const streamId = String(active?.dataset?.streamId || "");
    if (!streamId || streamId === activeStreamId) return;
    activeStreamId = streamId;
    setValue(codecEl, "جارٍ الفحص…");
    setValue(compatibilityEl, "جارٍ التحقق…", "warn");
    setValue(resolutionEl, "—");
    setValue(labelEl, "—");
    setValue(fpsEl, "—");
    setValue(protocolEl, "—");
    setValue(framesEl, "—");
    if (noteEl) noteEl.textContent = "المشغّل الأساسي يعمل كما هو؛ مسار التوافق لا يتدخل إلا إذا فشل فك الفيديو.";
    probe(streamId);
  }

  new MutationObserver(syncActive).observe(channelGrid, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  if (playerState) {
    new MutationObserver(() => {
      const text = String(playerState.textContent || "");
      if (/HLS/i.test(text)) setValue(protocolEl, "HLS", "good");
      else if (/\bTS\b/i.test(text)) setValue(protocolEl, "MPEG-TS", "good");
    }).observe(playerState, { childList: true, characterData: true, subtree: true });
  }

  video.addEventListener("loadedmetadata", updateVideoMetrics);
  video.addEventListener("resize", updateVideoMetrics);
  video.addEventListener("playing", () => {
    if (updateVideoMetrics()) {
      setValue(compatibilityEl, "✓ متوافق — تم فك الفيديو", "good");
      if (noteEl) noteEl.textContent = "نجح التشغيل الفعلي على هذا الجهاز.";
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
    setValue(protocolEl, "HLS fallback", "good");
    if (noteEl) noteEl.textContent = "فشل المسار الأساسي، لكن المختبر أعاد تشغيل القناة تلقائياً عبر مسار HLS المتوافق.";
  });

  window.addEventListener("kz:iptv-compat-unresolved", (event) => {
    if (String(event.detail?.streamId || "") !== activeStreamId) return;
    setValue(compatibilityEl, "✕ يحتاج Remux/Transcode على الخادم", "bad");
    if (noteEl) noteEl.textContent = "المصدر موجود، لكن كل مسارات المتصفح المتاحة فشلت. هذه الفئة تحتاج تحويل تغليف/codec على الخادم بدلاً من إخفائها من الكتالوج.";
  });

  setValue(browserEl, browserSummary(), hevc ? "good" : "warn");

  const fallbackScript = document.createElement("script");
  fallbackScript.src = "assets/js/iptv-lab-compat-fallback.js?v=20260904fallback1";
  fallbackScript.defer = true;
  document.head.appendChild(fallbackScript);
})();