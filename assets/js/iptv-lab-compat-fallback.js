(() => {
  "use strict";

  const grid = document.getElementById("channelGrid");
  const video = document.getElementById("previewVideo");
  const state = document.getElementById("playerState");
  if (!grid || !video || !state) return;

  const nativeHls = Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
  const hlsJsSupported = Boolean(window.Hls && window.Hls.isSupported?.());
  const probeCache = new Map();
  let generation = 0;
  let fallbackHls = null;

  async function getJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  async function getProbe(streamId) {
    if (!probeCache.has(streamId)) {
      probeCache.set(streamId, getJson(`/api/iptv-lab/probe?stream=${encodeURIComponent(streamId)}`).catch(() => null));
    }
    return probeCache.get(streamId);
  }

  async function getChannel(streamId) {
    const body = await getJson(`/api/iptv-lab/live?stream=${encodeURIComponent(streamId)}&limit=2`);
    return (body.portals || [])
      .flatMap((block) => block.streams || [])
      .find((row) => String(row.streamId) === String(streamId)) || null;
  }

  function hasDecodedVideo() {
    return Number(video.videoWidth) > 0 && Number(video.videoHeight) > 0 && !video.error;
  }

  function cleanupFallback() {
    if (fallbackHls) {
      try { fallbackHls.destroy(); } catch {}
      fallbackHls = null;
    }
  }

  async function nativeHlsFallback(channel, token) {
    if (!nativeHls || !channel?.playbackUrl || token !== generation) return false;
    cleanupFallback();
    try { video.pause(); } catch {}
    video.removeAttribute("src");
    video.load();
    state.textContent = "تجربة توافق HLS…";
    video.src = new URL(channel.playbackUrl, location.origin).toString();
    try {
      await video.play();
    } catch {}
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
        resolve(value);
      };
      const onPlaying = () => finish(hasDecodedVideo() || video.readyState >= 2);
      const onError = () => finish(false);
      const timer = setTimeout(() => finish(hasDecodedVideo()), 6500);
      video.addEventListener("playing", onPlaying, { once: true });
      video.addEventListener("error", onError, { once: true });
    });
  }

  async function hlsJsFallback(channel, token) {
    if (!hlsJsSupported || !channel?.playbackUrl || token !== generation) return false;
    cleanupFallback();
    try { video.pause(); } catch {}
    video.removeAttribute("src");
    video.load();
    state.textContent = "تجربة توافق HLS.js…";
    fallbackHls = new window.Hls({
      enableWorker: true,
      liveSyncDurationCount: 3,
      manifestLoadingMaxRetry: 2,
      fragLoadingMaxRetry: 3,
    });
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener("playing", onPlaying);
        resolve(value);
      };
      const onPlaying = () => finish(hasDecodedVideo() || video.readyState >= 2);
      const timer = setTimeout(() => finish(hasDecodedVideo()), 7000);
      fallbackHls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) finish(false);
      });
      video.addEventListener("playing", onPlaying, { once: true });
      fallbackHls.loadSource(new URL(channel.playbackUrl, location.origin).toString());
      fallbackHls.attachMedia(video);
      const attempt = video.play();
      if (attempt?.catch) attempt.catch(() => {});
    });
  }

  async function maybeRecover(streamId, token) {
    const probe = await getProbe(streamId);
    if (token !== generation || !probe?.playable || probe.mobileCompatible) return;

    // Give the existing player first chance. This helper is fallback-only.
    await new Promise((resolve) => setTimeout(resolve, 2600));
    if (token !== generation || hasDecodedVideo()) return;

    const channel = await getChannel(streamId).catch(() => null);
    if (token !== generation || !channel || hasDecodedVideo()) return;

    const codec = String(probe?.codecs?.video || "").toLowerCase();
    const audio = String(probe?.codecs?.audio || "").toLowerCase();
    console.info("IPTV Lab compatibility fallback", { streamId, codec, audio, protocol: probe.protocol });

    let recovered = false;
    if (nativeHls) recovered = await nativeHlsFallback(channel, token);
    if (!recovered && token === generation && hlsJsSupported) recovered = await hlsJsFallback(channel, token);

    if (token !== generation) return;
    if (recovered) {
      state.textContent = "يعمل · مسار توافق HLS";
      window.dispatchEvent(new CustomEvent("kz:iptv-compat-recovered", {
        detail: { streamId, codec, audio, protocol: probe.protocol || "" },
      }));
    } else {
      // Do not replace the original player error with a fake success. The
      // remaining class needs remux/transcode rather than another JS retry.
      window.dispatchEvent(new CustomEvent("kz:iptv-compat-unresolved", {
        detail: { streamId, codec, audio, protocol: probe.protocol || "" },
      }));
    }
  }

  grid.addEventListener("click", (event) => {
    const card = event.target.closest?.(".channel[data-stream-id]");
    if (!card) return;
    const streamId = String(card.dataset.streamId || "");
    if (!streamId) return;
    cleanupFallback();
    const token = ++generation;
    maybeRecover(streamId, token).catch((error) => {
      console.warn("IPTV Lab compatibility fallback failed", error);
    });
  });

  window.KZIptvLabCompatFallback = {
    version: "20260904fallback1",
    getProbe,
  };
})();