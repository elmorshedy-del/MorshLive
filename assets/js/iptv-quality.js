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

  if (
    !video
    || !channelGrid
    || !codecEl
    || !compatibilityEl
    || !resolutionEl
    || !labelEl
    || !fpsEl
    || !protocolEl
    || !framesEl
    || !browserEl
    || !noteEl
  ) return;

  let activeStreamId = "";
  let probeController = null;
  let frameLoopToken = 0;
  let fallbackFrameTimer = null;
  let playbackCheckTimer = null;

  const nativeHls = Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
  const hlsJs = Boolean(window.Hls && window.Hls.isSupported?.());
  const mpegTs = Boolean(window.mpegts && window.mpegts.isSupported?.());
  const hevcAdvertised = Boolean(
    video.canPlayType('video/mp4; codecs="hvc1"')
    || video.canPlayType('video/mp4; codecs="hev1"'),
  );

  function setValue(element, text, tone = "") {
    element.textContent = text;
    element.classList.remove("good", "warn", "bad");
    if (tone) element.classList.add(tone);
  }

  function codecName(value) {
    const codec = String(value || "").toLowerCase();
    if (codec === "hevc" || codec === "h265" || codec === "h.265") return "HEVC / H.265";
    if (codec === "h264" || codec === "h.264" || codec === "avc") return "H.264 / AVC";
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
    if (h > 0) return `${h}p`;
    return "بانتظار الفيديو";
  }

  function browserSummary() {
    const hls = nativeHls ? "HLS أصلي ✓" : hlsJs ? "HLS.js ✓" : "HLS ✕";
    const ts = mpegTs ? "TS ✓" : "TS ✕";
    const hevc = hevcAdvertised ? "HEVC معلن ✓" : "HEVC غير معلن ?";
    return `${hevc} · ${hls} · ${ts}`;
  }

  function resetDiagnostics() {
    clearTimeout(playbackCheckTimer);
    playbackCheckTimer = null;
    stopFrameMonitor();
    setValue(codecEl, "جارٍ الفحص…");
    setValue(compatibilityEl, "جارٍ التحقق…", "warn");
    setValue(resolutionEl, "—");
    setValue(labelEl, "—");
    setValue(fpsEl, "—");
    setValue(protocolEl, "—");
    setValue(framesEl, "—");
    setValue(browserEl, browserSummary(), hevcAdvertised ? "good" : "warn");
    noteEl.textContent = "الجودة تُقاس من الفيديو الذي يفكّه هذا الجهاز فعلياً؛ اسم الفئة أو كلمة HEVC وحدها لا تحدد الدقة.";
  }

  function updateVideoMetrics() {
    const width = Number(video.videoWidth) || 0;
    const height = Number(video.videoHeight) || 0;
    if (!width || !height) return false;
    setValue(resolutionEl, `${width} × ${height}`, "good");
    setValue(labelEl, qualityLabel(width, height), height >= 720 ? "good" : "warn");
    return true;
  }

  function updateFrameHealth() {
    if (typeof video.getVideoPlaybackQuality !== "function") {
      setValue(framesEl, "غير متاح");
      return;
    }
    const stats = video.getVideoPlaybackQuality();
    const total = Number(stats.totalVideoFrames) || 0;
    const dropped = Number(stats.droppedVideoFrames) || 0;
    if (!total) {
      setValue(framesEl, "بانتظار الإطارات");
      return;
    }
    const percent = (dropped / total) * 100;
    const tone = percent <= 1 ? "good" : percent <= 5 ? "warn" : "bad";
    setValue(framesEl, `${dropped}/${total} (${percent.toFixed(1)}%)`, tone);
  }

  function stopFrameMonitor() {
    frameLoopToken += 1;
    if (fallbackFrameTimer) {
      clearInterval(fallbackFrameTimer);
      fallbackFrameTimer = null;
    }
  }

  function startFrameMonitor() {
    stopFrameMonitor();
    const token = frameLoopToken;

    if (typeof video.requestVideoFrameCallback === "function") {
      let startedAt = 0;
      let frames = 0;
      const frame = (now) => {
        if (token !== frameLoopToken) return;
        if (!startedAt) startedAt = now;
        frames += 1;
        const elapsed = now - startedAt;
        if (elapsed >= 2000) {
          const fps = (frames * 1000) / elapsed;
          setValue(fpsEl, `${fps.toFixed(fps >= 10 ? 1 : 2)} FPS`, fps >= 24 ? "good" : "warn");
          updateFrameHealth();
          startedAt = now;
          frames = 0;
        }
        video.requestVideoFrameCallback(frame);
      };
      video.requestVideoFrameCallback(frame);
      return;
    }

    if (typeof video.getVideoPlaybackQuality === "function") {
      let lastFrames = Number(video.getVideoPlaybackQuality().totalVideoFrames) || 0;
      let lastTime = performance.now();
      fallbackFrameTimer = setInterval(() => {
        const now = performance.now();
        const stats = video.getVideoPlaybackQuality();
        const total = Number(stats.totalVideoFrames) || 0;
        const elapsed = now - lastTime;
        if (elapsed > 0 && total >= lastFrames) {
          const fps = ((total - lastFrames) * 1000) / elapsed;
          setValue(fpsEl, `${fps.toFixed(fps >= 10 ? 1 : 2)} FPS`, fps >= 24 ? "good" : "warn");
        }
        lastFrames = total;
        lastTime = now;
        updateFrameHealth();
      }, 2000);
      return;
    }

    setValue(fpsEl, "غير متاح");
    setValue(framesEl, "غير متاح");
  }

  function markPlaybackCompatibility() {
    const hasVideo = updateVideoMetrics();
    if (hasVideo) {
      setValue(compatibilityEl, "✓ متوافق — تم فك الفيديو", "good");
      noteEl.textContent = "تم التحقق عملياً على هذا الجهاز والمتصفح: الفيديو يُفك وتظهر إطارات حقيقية. راقب FPS والإطارات الساقطة للحكم على سلاسة البث.";
      return;
    }
    setValue(compatibilityEl, "الصوت/البث يعمل؛ الفيديو غير مؤكد", "warn");
    noteEl.textContent = "إذا بقيت الدقة 0×0 أو لم تظهر صورة بعد ثوانٍ، فغالباً هذا المتصفح لا يفك ترميز الفيديو الحالي أو أن البث لا يرسل صورة سليمة.";
  }

  function updateActualProtocol() {
    const text = String(playerState?.textContent || "");
    if (/HLS/i.test(text)) setValue(protocolEl, "HLS", "good");
    else if (/\bTS\b/i.test(text)) setValue(protocolEl, "MPEG-TS", "good");
  }

  async function probeStream(streamId) {
    if (probeController) probeController.abort();
    probeController = new AbortController();
    try {
      const response = await fetch(`/api/iptv-lab/probe?stream=${encodeURIComponent(streamId)}`, {
        cache: "no-store",
        signal: probeController.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (streamId !== activeStreamId) return;
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);

      if (data.protocol) setValue(protocolEl, String(data.protocol).toUpperCase());
      if (!data.playable) {
        setValue(codecEl, "لم يُكتشف", "warn");
        setValue(compatibilityEl, "فشل فحص المصدر", "warn");
        noteEl.textContent = "فحص المصدر لم يتمكن من تأكيد البث. جرّب التشغيل الفعلي؛ نجاح ظهور الصورة هو الاختبار الحاسم للتوافق.";
        return;
      }

      const codecs = data.codecs || {};
      const videoCodec = String(codecs.video || "").toLowerCase();
      const audioCodec = audioName(codecs.audio);
      setValue(codecEl, `${codecName(videoCodec)}${audioCodec ? ` · ${audioCodec}` : ""}`);

      if (videoCodec === "h264" && data.mobileCompatible) {
        setValue(compatibilityEl, "توافق واسع متوقع · بانتظار التشغيل", "good");
        noteEl.textContent = "المصدر H.264 مع صوت متوافق على نطاق واسع. سيصبح الحكم مؤكداً عندما تظهر دقة فعلية ويبدأ عدّ الإطارات.";
      } else if (videoCodec === "hevc") {
        if (hevcAdvertised) {
          setValue(compatibilityEl, "HEVC مدعوم مبدئياً · بانتظار التشغيل", "warn");
          noteEl.textContent = "المتصفح يعلن دعماً لـ HEVC، لكن التشغيل الفعلي هو الاختبار النهائي لأن الدعم يختلف حسب الجهاز ونظام التشغيل وطريقة التغليف.";
        } else {
          setValue(compatibilityEl, "HEVC غير معلن في المتصفح · بانتظار التشغيل", "warn");
          noteEl.textContent = "المتصفح لا يعلن HEVC عبر canPlayType. قد ينجح رغم ذلك حسب النظام؛ ظهور صورة ودقة فعلية سيؤكد التوافق.";
        }
      } else {
        setValue(compatibilityEl, "بانتظار اختبار التشغيل", "warn");
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      if (streamId !== activeStreamId) return;
      setValue(codecEl, "تعذر الفحص", "warn");
      setValue(compatibilityEl, "اختبار التشغيل سيحسم التوافق", "warn");
      noteEl.textContent = `تعذر فحص codec من المصدر: ${error.message || error}`;
    }
  }

  function syncActiveChannel() {
    const active = channelGrid.querySelector(".channel.active[data-stream-id]");
    const streamId = active?.dataset?.streamId || "";
    if (!streamId || streamId === activeStreamId) return;
    activeStreamId = streamId;
    resetDiagnostics();
    probeStream(streamId);
    updateActualProtocol();
  }

  const channelObserver = new MutationObserver(syncActiveChannel);
  channelObserver.observe(channelGrid, { subtree: true, attributes: true, attributeFilter: ["class"] });

  if (playerState) {
    const stateObserver = new MutationObserver(updateActualProtocol);
    stateObserver.observe(playerState, { childList: true, characterData: true, subtree: true });
  }

  video.addEventListener("loadedmetadata", () => {
    const hasVideo = updateVideoMetrics();
    updateFrameHealth();
    if (hasVideo && !video.paused) markPlaybackCompatibility();
  });
  video.addEventListener("resize", () => {
    if (updateVideoMetrics() && !video.paused) markPlaybackCompatibility();
  });
  video.addEventListener("playing", () => {
    startFrameMonitor();
    updateActualProtocol();
    clearTimeout(playbackCheckTimer);
    playbackCheckTimer = setTimeout(markPlaybackCompatibility, 500);
  });
  video.addEventListener("pause", stopFrameMonitor);
  video.addEventListener("ended", stopFrameMonitor);
  video.addEventListener("error", () => {
    stopFrameMonitor();
    if (!activeStreamId) return;
    setValue(compatibilityEl, "✕ فشل التشغيل على هذا الجهاز", "bad");
    noteEl.textContent = "فشل عنصر الفيديو في التشغيل. قد يكون السبب codec غير مدعوم، صيغة البث، أو خطأ في المصدر؛ راجع codec والبروتوكول أعلاه.";
  });

  setValue(browserEl, browserSummary(), hevcAdvertised ? "good" : "warn");
})();