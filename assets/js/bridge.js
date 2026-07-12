/* ============================================================================
 * bridge.js — Experimental headless-browser → HLS stream source.
 * Load after data.js. Adds a "Bridge" option to the server picker
 * alongside the existing embed sources.
 *
 * FAIL-CLOSED: returns no option if BRIDGE_CONFIG.origin is missing.
 * Never defaults to localhost.
 * ==========================================================================*/

(function () {
  "use strict";

  // ——— Config ——————————————————————————————————————————————————
  const BRIDGE_ORIGIN = (typeof BRIDGE_CONFIG !== "undefined" && BRIDGE_CONFIG.origin)
    || null;

  const BRIDGE_SLUGS = (typeof BRIDGE_CONFIG !== "undefined" && BRIDGE_CONFIG.slugs)
    || {};

  // ——— Add bridge to EMBEDS —————————————————————————————————————
  if (typeof EMBEDS !== "undefined") {
    EMBEDS.bridge = {
      url: null,   // resolved at runtime to HLS .m3u8
      directHls: true,
      labelKey: "bridge",
    };
  }

  // ——— Resolve bridge HLS URL ———————————————————————————————————
  function bridgeHlsUrl(channelId) {
    if (!BRIDGE_ORIGIN) return null;
    var slug = BRIDGE_SLUGS[channelId];
    if (!slug) return null;
    return "https://" + BRIDGE_ORIGIN + "/hls/live/" + slug + "/index.m3u8";
  }

  // ——— Extend streamOptionsFor — preserves original! —————————————
  var _origStreamOptionsFor = window.streamOptionsFor;
  window.streamOptionsFor = function (channelId, match, embedKey) {
    var opts = _origStreamOptionsFor
      ? _origStreamOptionsFor(channelId, match, embedKey)
      : [];

    // Prepend bridge option only when origin is configured AND channel has a slug
    var hls = bridgeHlsUrl(channelId);
    if (hls) {
      opts.unshift({
        id: "bridge",
        labelKey: "watch.optBridge",
        embedKey: "bridge",
        mode: "hls",
        kind: "direct",
        recommended: false,
        experimental: true,
        url: hls,
      });
    }

    return opts;
  };

  // ——— Expose for watch.js ——————————————————————————————————————
  window.STREAM_BRIDGE = {
    origin: BRIDGE_ORIGIN,
    slugs: BRIDGE_SLUGS,
    hlsUrl: bridgeHlsUrl,
    hasStream: function (chId) {
      return !!BRIDGE_ORIGIN && !!BRIDGE_SLUGS[chId];
    },
  };
})();
