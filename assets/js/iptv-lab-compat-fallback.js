(() => {
  "use strict";

  const grid = document.getElementById("channelGrid");
  const video = document.getElementById("previewVideo");
  const state = document.getElementById("playerState");
  if (!grid || !video || !state) return;

  const nativeHls = Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
  const hlsJsSupported = Boolean(window.Hls && window.Hls.isSupported?.());
  let generation = 0;
  let fallbackHls = null;

  async function getJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  // Always go through the quality panel's shared probe. This file used to keep
  // its own cache and fire a second /probe on every channel click; on a line
  // provisioned with max_connections: 1 that was two extra `/live/...` requests
  // racing the player for the only slot.
  async function getProbe(streamId) {
    const shared = window.KZIptvLabProbe?.request;
    if (!shared) return null;
    return shared(streamId).catch(() => null);
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
    if (token !== generation || hasDecodedVideo()) return;

    const probe = await getProbe(streamId);
    if (token !== generation || hasDecodedVideo()) return;
    if (!probe?.playable || probe.mobileCompatible) return;

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
      // Leaving "تجربة توافق…" on screen would claim an attempt is still
      // running when it has already finished and failed.
      state.textContent = "تعذر التشغيل بأي مسار متاح";
      window.dispatchEvent(new CustomEvent("kz:iptv-compat-unresolved", {
        detail: { streamId, codec, audio, protocol: probe.protocol || "" },
      }));
    }
  }

  // Selecting a channel only arms this helper — it makes no request of its own.
  // It used to probe and fetch the channel on every click, which on a
  // max_connections: 1 line was two more `/live/...` requests competing with
  // the player that had just started.
  let armedStreamId = "";
  grid.addEventListener("click", (event) => {
    const card = event.target.closest?.(".channel[data-stream-id]");
    if (!card) return;
    const streamId = String(card.dataset.streamId || "");
    if (!streamId) return;
    cleanupFallback();
    armedStreamId = streamId;
    generation += 1;
  });

  // Run only once the main player has exhausted its own MPEG-TS and HLS paths.
  // By then nothing is holding the connection, so the extra attempt is free.
  window.addEventListener("kz:iptv-playback-failed", () => {
    if (!armedStreamId) return;
    const token = generation;
    maybeRecover(armedStreamId, token).catch((error) => {
      console.warn("IPTV Lab compatibility fallback failed", error);
    });
  });

  window.KZIptvLabCompatFallback = {
    version: "20260905ts2",
    getProbe,
  };
})();