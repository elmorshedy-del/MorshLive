/* KHALEEJI 27 V2 hold.
 * Watch.js plan refresh calls loadPlayer every 20s and can remount HLS.
 * Keep metadata ticking without destroying the healthy V2 player for the
 * pre-mapped Gulf Cup group-stage fixtures.
 */
(function () {
  "use strict";
  var matchId = new URLSearchParams(location.search).get("match");
  var mapped = new Set([
    "espn-global.gulf_cup-401922489",
    "espn-global.gulf_cup-401922490",
    "espn-global.gulf_cup-401922491",
    "espn-global.gulf_cup-401922492",
    "espn-global.gulf_cup-401922493",
    "espn-global.gulf_cup-401922494",
    "espn-global.gulf_cup-401922495",
    "espn-global.gulf_cup-401922496",
    "espn-global.gulf_cup-401922497",
    "espn-global.gulf_cup-401922498",
    "espn-global.gulf_cup-401922499",
    "espn-global.gulf_cup-401922500",
  ]);
  if (!mapped.has(matchId)) return;
  var orig = window.setInterval;
  window.setInterval = function (fn, delay) {
    if (Number(delay) === 20000) {
      return orig(function () {}, delay);
    }
    return orig.apply(this, arguments);
  };
})();
