/* ============================================================================
 * stream-check.js — Live server/stream health detection for KoraZero.
 *
 * Goal: stop users from guessing which "سيرفر / بث" button works. We probe each
 * server and highlight the live ones, auto-selecting the first healthy server.
 *
 * Detection strategy (robust + honest about browser limits):
 *   • HLS links (.m3u8, our own servers): a REAL playback check — load the
 *     manifest with hls.js (or native HLS) in a throwaway <video> and confirm it
 *     parses. This genuinely proves the stream is alive.
 *   • Cross-origin embeds (worldkoora VIP iframes): the browser forbids reading
 *     what plays inside a third-party iframe, so we can only do a reachability
 *     probe (does the server respond?). We label these accordingly.
 *
 * Results are cached briefly so re-checks (live, every refresh) stay cheap.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const t = (k, v) => (global.I18N ? global.I18N.t(k, v) : k);
  const CACHE_TTL = 45 * 1000;
  const cache = new Map();

  function fromCache(key, factory) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.promise;
    const promise = factory();
    cache.set(key, { at: Date.now(), promise });
    // Don't cache hard failures forever — let them re-probe sooner.
    promise.then((r) => {
      if (!r || !r.ok) cache.delete(key);
    }).catch(() => cache.delete(key));
    return promise;
  }

  /* --------------------------------------------- Real HLS playback probe */
  // Detect whether a parsed HLS manifest actually carries an audio track —
  // either a dedicated audio rendition or audio muxed into the video levels
  // (e.g. CODECS="avc1…,mp4a.40.2"). Returns true / false / null (unknown).
  function manifestHasAudio(data) {
    if (!data) return null;
    if (data.audioTracks && data.audioTracks.length) return true;
    const levels = data.levels || [];
    if (!levels.length) return null;
    // If the manifest declares no codecs at all, we genuinely can't tell — say
    // "unknown" rather than falsely reporting silence.
    const hasAnyCodec = levels.some((l) =>
      l && (l.audioCodec || l.videoCodec || (l.attrs && (l.attrs.CODECS || l.attrs.codecs)))
    );
    if (!hasAnyCodec) return null;
    return levels.some((l) =>
      l && (l.audioCodec || /mp4a|ac-3|ec-3|opus|mp3|aac/i.test(
        (l.attrs && (l.attrs.CODECS || l.attrs.codecs)) || ""
      ))
    );
  }

  // Best-effort audio detection on the native (Safari/iOS) path, where hls.js
  // metadata isn't available.
  function videoHasAudio(video) {
    if (typeof video.mozHasAudio === "boolean") return video.mozHasAudio;
    if (video.audioTracks && typeof video.audioTracks.length === "number") {
      return video.audioTracks.length > 0;
    }
    // At loadedmetadata no decoding has happened yet, so a 0 count means
    // "unknown", not "no audio".
    if (typeof video.webkitAudioDecodedByteCount === "number") {
      return video.webkitAudioDecodedByteCount > 0 ? true : null;
    }
    return null;
  }

  function probeHls(url, { timeout = 7000 } = {}) {
    return new Promise((resolve) => {
      const started = (global.performance || Date).now();
      let settled = false;
      let hls = null;
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "metadata";
      video.crossOrigin = "anonymous";

      const timer = setTimeout(() => finish(false), timeout);

      function cleanup() {
        clearTimeout(timer);
        try { if (hls) hls.destroy(); } catch (e) { /* noop */ }
        try { video.removeAttribute("src"); video.load(); } catch (e) { /* noop */ }
      }
      function finish(ok, audio) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          ok,
          audio: ok ? (audio == null ? null : audio) : null,
          ms: Math.round((global.performance || Date).now() - started),
        });
      }

      try {
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.addEventListener("loadedmetadata", () => finish(true, videoHasAudio(video)), { once: true });
          video.addEventListener("error", () => finish(false), { once: true });
          video.src = url;
        } else if (global.Hls && global.Hls.isSupported()) {
          hls = new global.Hls({ enableWorker: false, maxBufferLength: 4 });
          hls.on(global.Hls.Events.MANIFEST_PARSED, (_e, data) => finish(true, manifestHasAudio(data)));
          hls.on(global.Hls.Events.ERROR, (_e, data) => { if (data && data.fatal) finish(false); });
          hls.loadSource(url);
          hls.attachMedia(video);
        } else {
          probeReachable(url, { timeout }).then((r) => finish(r.ok));
        }
      } catch (e) {
        finish(false);
      }
    });
  }

  /* --------------------------------------------- Reachability probe (cross-origin) */
  function probeReachable(url, { timeout = 6000 } = {}) {
    const started = (global.performance || Date).now();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => controller && controller.abort(), timeout);
    const done = (ok) => ({ ok, ms: Math.round((global.performance || Date).now() - started) });

    return fetch(url, {
      mode: "no-cors",
      cache: "no-store",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: controller ? controller.signal : undefined,
    })
      .then(() => done(true))
      .catch(() => done(false))
      .finally(() => clearTimeout(timer));
  }

  /* --------------------------------------------- UI helpers */
  function ensureHint(row) {
    let hint = row.nextElementSibling;
    if (hint && hint.classList && hint.classList.contains("server-hint")) return hint;
    hint = document.createElement("div");
    hint.className = "server-hint";
    if (row.parentNode) row.parentNode.insertBefore(hint, row.nextSibling);
    return hint;
  }

  function setState(btn, state, ms, audio) {
    btn.classList.remove("srv-checking", "srv-ok", "srv-down", "srv-noaudio");
    btn.classList.add("srv-" + state);
    let dot = btn.querySelector(".srv-state");
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "srv-state";
      dot.setAttribute("aria-hidden", "true");
      btn.appendChild(dot);
    }
    if (state === "ok") {
      const noAudio = audio === false;
      if (noAudio) btn.classList.add("srv-noaudio");
      dot.textContent = noAudio ? "🔇" : "✓";
      const audioNote = audio === false ? " · " + t("srv.noAudio") : audio === true ? " · " + t("srv.hasAudio") : "";
      btn.title = (ms ? `${t("srv.working")} · ${ms}ms` : t("srv.working")) + audioNote;
      btn.setAttribute("aria-label",
        (btn.dataset.label || btn.textContent || t("watch.server")) + " — " + t("srv.working") + audioNote);
    } else if (state === "down") {
      dot.textContent = "✕";
      btn.title = t("srv.unreachable");
    } else {
      dot.textContent = "";
      btn.title = t("srv.checkingOne");
    }
  }

  function probeButton(btn) {
    const url = btn.dataset.url;
    if (!url) return Promise.resolve({ ok: false });
    const kind = btn.dataset.kind || "reachable";
    if (kind === "hls") return fromCache("hls:" + url, () => probeHls(url));
    return fromCache("reach:" + url, () => probeReachable(url));
  }

  /* --------------------------------------------- Orchestrator */
  function autoHighlight(row, opts) {
    opts = opts || {};
    if (!row) return Promise.resolve(null);
    const buttons = Array.prototype.slice.call(row.querySelectorAll(".server-btn[data-url]"));
    if (!buttons.length) return Promise.resolve(null);

    const gen = (row.__kzCheckGen = (row.__kzCheckGen || 0) + 1);
    const hint = ensureHint(row);
    buttons.forEach((b) => setState(b, "checking"));
    hint.className = "server-hint checking";
    hint.textContent = t("srv.checking");

    return Promise.all(
      buttons.map((b) => probeButton(b).then((r) => ({ b, ok: !!(r && r.ok), ms: r && r.ms, audio: r && r.audio }))
        .catch(() => ({ b, ok: false })))
    ).then((results) => {
      if (gen !== row.__kzCheckGen) return null; // a newer check superseded this run
      let firstOk = null;
      results.forEach(({ b, ok, ms, audio }) => {
        setState(b, ok ? "ok" : "down", ms, audio);
        if (ok && !firstOk) firstOk = b;
      });

      const okCount = results.filter((r) => r.ok).length;
      const muteCount = results.filter((r) => r.ok && r.audio === false).length;
      if (okCount > 0) {
        hint.className = "server-hint ok";
        const muteNote = muteCount
          ? ` — <b>${muteCount}</b> ${t("srv.muteSuffix")}`
          : "";
        hint.innerHTML = `<span class="server-hint-dot"></span> ${t("srv.okPrefix")} <b>${okCount}</b> ${t("srv.okSuffix")}${muteNote}`;
      } else {
        hint.className = "server-hint down";
        hint.textContent = t("srv.down");
      }

      if (firstOk && opts.autoSelect !== false) {
        const kind = firstOk.dataset.kind || "reachable";
        // Never auto-switch cross-origin embeds — it reloads the player mid-stream.
        if (kind === "reachable") return { okCount, firstOk };
        const active = row.querySelector(".server-btn.active");
        const needsSwitch = !active || active.classList.contains("srv-down");
        if (needsSwitch && active !== firstOk) firstOk.click();
      }
      return { okCount, firstOk };
    });
  }

  global.StreamCheck = { probeHls, probeReachable, autoHighlight };
})(window);
