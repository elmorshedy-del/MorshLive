/* Share the first live-fixture request across concurrent page consumers.
 *
 * The unified IPTV layer and the normal homepage both ask getMatches() for the
 * same data during DOMContentLoaded. MatchesAPI caches only after a request has
 * completed, so without this wrapper those callers race and duplicate the
 * football scoreboard fan-out. This keeps the existing cache/force semantics
 * but makes non-forced concurrent calls share one in-flight promise.
 */
(function (global) {
  "use strict";

  let installed = false;

  function install() {
    if (installed) return true;
    const api = global.MatchesAPI;
    if (!api || typeof api.fetchLiveSoccer !== "function") return false;
    if (api.fetchLiveSoccer.__kzInFlightDedupe) {
      installed = true;
      return true;
    }

    const original = api.fetchLiveSoccer.bind(api);
    let inFlight = null;

    function wrapped(options = {}) {
      const force = !!options?.force;
      if (!force && inFlight) return inFlight;

      const request = Promise.resolve().then(() => original(options));
      if (force) return request;

      const shared = request.finally(() => {
        if (inFlight === shared) inFlight = null;
      });
      inFlight = shared;
      return shared;
    }

    wrapped.__kzInFlightDedupe = true;
    wrapped.__kzOriginal = original;
    api.fetchLiveSoccer = wrapped;
    installed = true;
    return true;
  }

  function installWhenReady() {
    if (install()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 200) clearInterval(timer);
    }, 10);
  }

  // Loaded from the head before iptv-auto.js. Registration order guarantees
  // this DOMContentLoaded callback runs before IPTV's own startup callback,
  // after matches-api.js has been parsed and exposed on window.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  }
  installWhenReady();
})();
