/* ============================================================================
 * bridge.js — Experimental headless-browser → HLS stream source.
 * Load after data.js. Adds a "Bridge" option to the server picker
 * alongside the existing koraplus/daddy/sirtv/ntv/kooracity embeds.
 *
 * Does NOT modify any existing file. Purely additive.
 * ==========================================================================*/

(function () {
  "use strict";

  // ——— Config ——————————————————————————————————————————————————
  const BRIDGE_HOST = (typeof BRIDGE_CONFIG !== "undefined" && BRIDGE_CONFIG.host)
    || "localhost:80";

  const BRIDGE_SLUGS = (typeof BRIDGE_CONFIG !== "undefined" && BRIDGE_CONFIG.slugs)
    || {
      "bein-max-2": "bein-max2-ar",
      "bein-max-3": "bein-max3-ar",
      "bein-max-4": "bein-max4-ar",
      "bein-sports-1": "bein-sports1",
      "bein-sports-2": "bein-sports2",
    };

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
    var slug = BRIDGE_SLUGS[channelId];
    if (!slug) return null;
    return "http://" + BRIDGE_HOST + "/hls/live/" + slug + "/index.m3u8";
  }

  // ——— Extend streamOptionsFor — preserves original! —————————————
  var _origStreamOptionsFor = window.streamOptionsFor;
  window.streamOptionsFor = function (channelId, match, embedKey) {
    var opts = _origStreamOptionsFor
      ? _origStreamOptionsFor(channelId, match, embedKey)
      : [];

    // Prepend bridge option when this channel has a slug mapping
    var hls = bridgeHlsUrl(channelId);
    if (hls) {
      opts.unshift({
        id: "bridge",
        labelKey: "watch.optBridge",
        hintKey: "watch.optBridgeHint",
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
    host: BRIDGE_HOST,
    slugs: BRIDGE_SLUGS,
    hlsUrl: bridgeHlsUrl,
    hasStream: function (chId) {
      return !!BRIDGE_SLUGS[chId];
    },
  };
})();
