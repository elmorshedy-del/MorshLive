(() => {
  "use strict";

  const video = document.getElementById("previewVideo");
  const channelGrid = document.getElementById("channelGrid");
  const playerBox = document.getElementById("playerBox");
  const playerEmpty = document.getElementById("playerEmpty");
  const playerTools = document.getElementById("playerTools");
  const playerState = document.getElementById("playerState");
  const selectedName = document.getElementById("selectedName");
  const selectedMeta = document.getElementById("selectedMeta");
  const selectedMetaChip = document.getElementById("selectedMetaChip");
  const recBtn = document.getElementById("recBtn");

  const codecEl = document.getElementById("qualityCodec");
  const compatibilityEl = document.getElementById("qualityCompatibility");
  const resolutionEl = document.getElementById("qualityResolution");
  const labelEl = document.getElementById("qualityLabel");
  const fpsEl = document.getElementById("qualityFps");
  const protocolEl = document.getElementById("qualityProtocol");
  const framesEl = document.getElementById("qualityFrames");
  const browserEl = document.getElementById("qualityBrowser");
  const noteEl = document.getElementById("qualityNote");

  if (!video || !channelGrid || !playerState) return;

  const nativeHls = Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
  const hlsJs = Boolean(window.Hls && window.Hls.isSupported?.());
  const mpegTs = Boolean(window.mpegts && window.mpegts.isSupported?.());
  const hevcAdvertised = Boolean(
    video.canPlayType('video/mp4; codecs="hvc1"')
    || video.canPlayType('video/mp4; codecs="hev1"'),
  );

  let generation = 0;
  let hls = null;
  let tsPlayer = null;
  let frameTimer = null;
  let activeProbe = null;
  let activeChannel = null;
  let attemptInProgress = false;

  function setValue(element, text, tone = "") {
    if (!element) return;
    element.textContent = text;
    element.classList.remove("good", "warn", "bad");
    if (tone) element.classList.add(tone);
  }

  function browserSummary() {
    const hls = nativeHls ? "HLS أصلي ✓" : hlsJs ? "HLS.js ✓" : "HLS ✕";
    const ts = mpegTs ? "TS ✓" : "TS ✕";
    const hevc = hevcAdvertised ? "HEVC معلن ✓" : "HEVC غير معلن ?";
    return `${hevc} · ${hls} · ${ts}`;
  }

  function qualityLabel(width, height) {
    const h = Number(height) || 0;
    const w = Number(width) || 0;
    if (h >= 2160 || w >= 3840) return "4K / UHD";
    if (h >= 1440 || w >= 2560) return "1440p / QHD";
    if (h >= 1080 || w >= 1920) return "1080p / Full HD";
    if (h >= 720 || w >= 1280) return "720p / HD";
    if (h >= 480) return `${h}p / SD`;
    return h > 0 ? `${h}p` : "بانتظار الفيديو";
  }

  function codecName(value) {
    const codec = String(value || "").toLowerCase();
    if (["hevc", "h265", "h.265"].includes(codec)) return "HEVC / H.265";
    if (["h264", "h.264", "avc"].includes(codec)) return "H.264 / AVC";
    return codec ? codec.toUpperCase() : "غير معروف";
  }

  function audioName(value) {
    const codec = String(value || "").toLowerCase();
    if (codec === "aac") return "AAC";
    if (codec === "ac3") return "AC-3";
    if (codec === "mp2") return "MP2";
    return codec ? codec.toUpperCase() : "";
  }

  function resetDiagnostics() {
    setValue(codecEl, "جارٍ الفحص…");
    setValue(compatibilityEl, "جارٍ التحقق…", "warn");
    setValue(resolutionEl, "—");
    setValue(labelEl, "—");
    setValue(fpsEl, "—");
    setValue(protocolEl, "—");
    setValue(framesEl, "—");
    setValue(browserEl, browserSummary(), hevcAdvertised ? "good" : "warn");
    if (noteEl) noteEl.textContent = "يُفحص نوع البث والـ codec أولاً، ثم يختار المختبر مسار التشغيل الأنسب تلقائياً.";
  }

  function updateVideoMetrics() {
    const width = Number(video.videoWidth) || 0;
    const height = Number(video.videoHeight) || 0;
    if (!width || !height) return false;
    setValue(resolutionEl, `${width} × ${height}`, "good");
    setValue(labelEl, qualityLabel(width, height), height >= 720 ? "good" : "warn");
    return true;
  }

  function stopFrameMonitor() {
    if (frameTimer) clearInterval(frameTimer);
    frameTimer = null;
  }

  function startFrameMonitor() {
    stopFrameMonitor();
    if (typeof video.getVideoPlaybackQuality !== "function") return;
    let lastFrames = Number(video.getVideoPlaybackQuality().totalVideoFrames) || 0;
    let lastAt = performance.now();
    frameTimer = setInterval(() => {
      const stats = video.getVideoPlaybackQuality();
      const now = performance.now();
      const total = Number(stats.totalVideoFrames) || 0;
      const dropped = Number(stats.droppedVideoFrames) || 0;
      const elapsed = now - lastAt;
      if (elapsed > 0 && total >= lastFrames) {
        const fps = ((total - lastFrames) * 1000) / elapsed;
        setValue(fpsEl, `${fps.toFixed(fps >= 10 ? 1 : 2)} FPS`, fps >= 20 ? "good" : "warn");
      }
      if (total) {
        const pct = (dropped / total) * 100;
        setValue(framesEl, `${dropped}/${total} (${pct.toFixed(1)}%)`, pct <= 1 ? "good" : pct <= 5 ? "warn" : "bad");
      }
      lastFrames = total;
      lastAt = now;
    }, 2000);
  }

  function destroyPlayers() {
    stopFrameMonitor();
    attemptInProgress = false;
    try { hls?.destroy(); } catch {}
    hls = null;
    if (tsPlayer) {
      try { tsPlayer.pause(); } catch {}
      try { tsPlayer.unload(); } catch {}
      try { tsPlayer.detachMediaElement(); } catch {}
      try { tsPlayer.destroy(); } catch {}
      tsPlayer = null;
    }
    try { video.pause(); } catch {}
    video.removeAttribute("src");
    video.load();
  }

  function showPlayer() {
    playerBox?.classList.add("is-playing");
    if (playerEmpty) playerEmpty.hidden = true;
    if (playerTools) playerTools.hidden = false;
  }

  async function json(url) {
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  async function resolveChannel(streamId) {
    const body = await json(`/api/iptv-lab/live?stream=${encodeURIComponent(streamId)}&limit=2`);
    const rows = (body.portals || []).flatMap((block) => block.streams || []);
    const channel = rows.find((row) => String(row.streamId) === String(streamId));
    if (!channel) throw new Error("لم تُعثر على القناة في الكتالوج الحالي");
    return channel;
  }

  async function probeChannel(channel) {
    const params = new URLSearchParams({ stream: String(channel.streamId) });
    if (channel.portalId) params.set("portal", String(channel.portalId));
    try {
      return await json(`/api/iptv-lab/probe?${params}`);
    } catch (error) {
      return { ok: false, playable: false, error: error.message || String(error), codecs: null, protocol: null };
    }
  }

  function updateProbeUi(probe) {
    const codecs = probe?.codecs || {};
    const audio = audioName(codecs.audio);
    setValue(codecEl, `${codecName(codecs.video)}${audio ? ` · ${audio}` : ""}`, probe?.playable ? "good" : "warn");
    if (probe?.protocol) setValue(protocolEl, String(probe.protocol).toUpperCase(), "good");
    if (!probe?.playable) {
      setValue(compatibilityEl, "المصدر لم يُحسم بالفحص · نجرب التشغيل فعلياً", "warn");
      if (noteEl) noteEl.textContent = "فحص البداية لم يحسم نوع المصدر. لن نعتبر القناة فاشلة قبل تجربة مسارات التشغيل المتاحة.";
      return;
    }
    if (String(codecs.video || "").toLowerCase() === "hevc") {
      setValue(compatibilityEl, "HEVC مكتشف · اختيار مسار مناسب للجهاز", "warn");
    } else {
      setValue(compatibilityEl, "المصدر صالح · بانتظار فك الفيديو", "good");
    }
  }

  function waitForPlayback(token, timeoutMs = 8500) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (ok, reason) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
        if (token !== generation) return reject(new Error("superseded"));
        ok ? resolve(true) : reject(new Error(reason || "playback failed"));
      };
      const onPlaying = () => finish(true);
      const onError = () => finish(false, "video error");
      const timer = setTimeout(() => finish(false, "startup timeout"), timeoutMs);
      video.addEventListener("playing", onPlaying, { once: true });
      video.addEventListener("error", onError, { once: true });
    });
  }

  async function attemptNativeHls(url, token) {
    if (!nativeHls || !url) throw new Error("native HLS unavailable");
    destroyPlayers();
    attemptInProgress = true;
    playerState.textContent = "جارٍ تجربة HLS الأصلي…";
    setValue(protocolEl, "HLS أصلي", "warn");
    video.src = new URL(url, location.origin).toString();
    const promise = waitForPlayback(token);
    const play = video.play();
    if (play?.catch) play.catch(() => {});
    await promise;
    attemptInProgress = false;
  }

  async function attemptHlsJs(url, token) {
    if (!hlsJs || !url) throw new Error("HLS.js unavailable");
    destroyPlayers();
    attemptInProgress = true;
    playerState.textContent = "جارٍ تجربة HLS.js…";
    setValue(protocolEl, "HLS.js", "warn");
    hls = new window.Hls({ enableWorker: true, liveSyncDurationCount: 3, manifestLoadingMaxRetry: 2, fragLoadingMaxRetry: 3 });
    const fatal = new Promise((_, reject) => {
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) reject(new Error(data.details || data.type || "HLS fatal error"));
      });
    });
    hls.loadSource(new URL(url, location.origin).toString());
    hls.attachMedia(video);
    const play = video.play();
    if (play?.catch) play.catch(() => {});
    await Promise.race([waitForPlayback(token), fatal]);
    attemptInProgress = false;
  }

  async function attemptTs(url, token) {
    if (!mpegTs || !url) throw new Error("MPEG-TS unavailable");
    destroyPlayers();
    attemptInProgress = true;
    playerState.textContent = "جارٍ تجربة TS مباشر…";
    setValue(protocolEl, "MPEG-TS", "warn");
    tsPlayer = window.mpegts.createPlayer(
      { type: "mpegts", isLive: true, url: new URL(url, location.origin).toString() },
      { enableWorker: false, enableStashBuffer: true, stashInitialSize: 384 * 1024, liveSync: true },
    );
    const fatal = new Promise((_, reject) => {
      tsPlayer.on(window.mpegts.Events.ERROR, (type, detail) => reject(new Error(`${type || "TS"}: ${detail || "error"}`)));
    });
    tsPlayer.attachMediaElement(video);
    tsPlayer.load();
    const play = tsPlayer.play();
    if (play?.catch) play.catch(() => {});
    await Promise.race([waitForPlayback(token), fatal]);
    attemptInProgress = false;
  }

  function buildAttempts(channel, probe) {
    const codec = String(probe?.codecs?.video || "").toLowerCase();
    const protocol = String(probe?.protocol || "").toLowerCase();
    const attempts = [];
    const add = (name, fn) => {
      if (!attempts.some((row) => row.name === name)) attempts.push({ name, fn });
    };

    if (codec === "hevc") {
      if (nativeHls) add("native-hls", (token) => attemptNativeHls(channel.playbackUrl, token));
      if (hlsJs) add("hls-js", (token) => attemptHlsJs(channel.playbackUrl, token));
      return attempts;
    }

    if (protocol === "hls" && nativeHls) add("native-hls", (token) => attemptNativeHls(channel.playbackUrl, token));
    if (mpegTs) add("mpeg-ts", (token) => attemptTs(channel.tsPlaybackUrl, token));
    if (nativeHls) add("native-hls", (token) => attemptNativeHls(channel.playbackUrl, token));
    if (hlsJs) add("hls-js", (token) => attemptHlsJs(channel.playbackUrl, token));
    return attempts;
  }

  async function playUniversal(channel, card) {
    const token = ++generation;
    activeChannel = channel;
    destroyPlayers();
    showPlayer();
    resetDiagnostics();

    channelGrid.querySelectorAll(".channel.active").forEach((node) => node.classList.remove("active"));
    card?.classList.add("active");
    if (selectedName) selectedName.textContent = channel.name || "قناة";
    if (selectedMeta) selectedMeta.textContent = `${channel.categoryName || "بدون فئة"} · Stream ${channel.streamId}`;
    if (selectedMetaChip) selectedMetaChip.textContent = "اختيار تلقائي لمسار التشغيل";
    playerState.textContent = "جارٍ فحص المصدر…";

    const probe = await probeChannel(channel);
    if (token !== generation) return;
    activeProbe = probe;
    updateProbeUi(probe);

    const attempts = buildAttempts(channel, probe);
    const errors = [];
    for (const attempt of attempts) {
      if (token !== generation) return;
      try {
        await attempt.fn(token);
        if (token !== generation) return;
        playerState.textContent = `يعمل · ${attempt.name === "mpeg-ts" ? "TS مباشر" : "HLS"}`;
        setValue(compatibilityEl, "✓ متوافق — تم تشغيل الفيديو فعلياً", "good");
        if (updateVideoMetrics()) startFrameMonitor();
        if (noteEl) noteEl.textContent = "تم اختيار مسار التشغيل من codec/protocol الفعليين، وليس من اسم القناة. التشغيل الفعلي هو معيار النجاح.";
        return;
      } catch (error) {
        errors.push(`${attempt.name}: ${error.message || error}`);
      }
    }

    attemptInProgress = false;
    playerState.textContent = "تعذر التشغيل بعد تجربة المسارات المتاحة";
    setValue(compatibilityEl, "✕ فشلت كل مسارات التشغيل على هذا الجهاز", "bad");
    if (noteEl) {
      const codec = codecName(probe?.codecs?.video);
      noteEl.textContent = `${codec}. جُرّبت المسارات المتاحة فعلياً${errors.length ? `: ${errors.join(" · ")}` : ""}. إذا كان المصدر HEVC والجهاز لا يفك HEVC، يلزم transcoding إلى H.264 على الخادم لتحقيق توافق شامل.`;
    }
  }

  async function chooseByStreamId(streamId, card) {
    try {
      const channel = await resolveChannel(streamId);
      await playUniversal(channel, card);
    } catch (error) {
      playerState.textContent = "تعذر تحميل القناة";
      setValue(compatibilityEl, "تعذر بدء الاختبار", "bad");
      if (noteEl) noteEl.textContent = error.message || String(error);
    }
  }

  channelGrid.addEventListener("click", (event) => {
    const card = event.target.closest?.(".channel[data-stream-id]");
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    chooseByStreamId(card.dataset.streamId, card);
  }, true);

  recBtn?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    recBtn.disabled = true;
    const old = recBtn.textContent;
    recBtn.textContent = "جارٍ البحث…";
    try {
      const body = await json("/api/iptv-lab/live?q=bein%20sports%201%20sd&limit=80");
      const rows = (body.portals || []).flatMap((block) => block.streams || []);
      const channel = rows.find((row) => /bein\s+sports?\s+(?:1\s+sd|sd\s*1)/i.test(String(row.name || ""))) || rows[0];
      if (!channel) throw new Error("لم تُعثر على قناة BEIN SPORTS 1 SD");
      const card = channelGrid.querySelector(`[data-stream-id="${CSS.escape(String(channel.streamId))}"]`);
      await playUniversal(channel, card);
    } catch (error) {
      setValue(compatibilityEl, "تعذر تشغيل القناة المقترحة", "bad");
      if (noteEl) noteEl.textContent = error.message || String(error);
    } finally {
      recBtn.textContent = old || "▶ AR BEIN SPORTS 1 SD";
      recBtn.disabled = false;
    }
  }, true);

  video.addEventListener("loadedmetadata", updateVideoMetrics);
  video.addEventListener("resize", updateVideoMetrics);
  video.addEventListener("playing", () => {
    if (!attemptInProgress && activeChannel) {
      updateVideoMetrics();
      startFrameMonitor();
    }
  });
  video.addEventListener("pause", stopFrameMonitor);
  video.addEventListener("ended", stopFrameMonitor);
  video.addEventListener("error", () => {
    if (attemptInProgress) return;
    if (!activeChannel) return;
    setValue(compatibilityEl, "حدث خطأ بعد بدء التشغيل", "warn");
  });

  setValue(browserEl, browserSummary(), hevcAdvertised ? "good" : "warn");
  window.KZIptvLabUniversal = {
    version: "20260904probe1",
    playByStreamId: chooseByStreamId,
    get activeProbe() { return activeProbe; },
  };
})();