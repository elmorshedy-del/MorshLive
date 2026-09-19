/* MATCHDAY 2026-09-19 — Sevilla vs Barcelona V2 hold.
 * Watch.js plan refresh calls loadPlayer every 20s and remounts HLS.
 * For this exact fixture only, keep metadata ticking off that interval.
 * Rollback: remove this script tag from watch.html and delete this file.
 */
(function () {
  "use strict";
  var matchId = new URLSearchParams(location.search).get("match");
  if (matchId !== "espn-esp.1-401882859") return;
  var orig = window.setInterval;
  window.setInterval = function (fn, delay) {
    if (Number(delay) === 20000) {
      return orig(function () {}, delay);
    }
    return orig.apply(this, arguments);
  };
})();
