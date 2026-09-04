/* Shared deterministic TV window for match-channel playback.
 *
 * TV becomes eligible 30 minutes before kickoff, stays eligible through the
 * normal 135-minute football window, then remains available for a 30-minute
 * post-match studio window. Replay/highlight retention is intentionally
 * separate and remains owned by data.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KZIptvWindow = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const PRE_MATCH_MINUTES = 30;
  const MATCH_WINDOW_MINUTES = 135;
  const POST_MATCH_MINUTES = 30;
  const TV_END_MINUTES = MATCH_WINDOW_MINUTES + POST_MATCH_MINUTES;

  function kickoffMs(match) {
    const value = Date.parse(String(match?.kickoffUtc || ""));
    return Number.isFinite(value) ? value : NaN;
  }

  function minutesFromKickoff(match, now = Date.now()) {
    const kick = kickoffMs(match);
    const at = typeof now === "number" ? now : Date.parse(now);
    if (!Number.isFinite(kick) || !Number.isFinite(at)) return Number.NaN;
    return (at - kick) / 60000;
  }

  function phase(match, now = Date.now()) {
    const elapsed = minutesFromKickoff(match, now);
    if (!Number.isFinite(elapsed)) return match?.status === "live" ? "live" : "details";
    if (elapsed < -PRE_MATCH_MINUTES) return "details";
    if (elapsed < 0) return "pregame";
    if (match?.status === "live" || elapsed <= MATCH_WINDOW_MINUTES) return "live";
    if (elapsed <= TV_END_MINUTES) return "postgame";
    return "after";
  }

  function isEligible(match, now = Date.now()) {
    return ["pregame", "live", "postgame"].includes(phase(match, now));
  }

  function cardActionKey(match, now = Date.now()) {
    const current = phase(match, now);
    if (current === "details") return "card.matchCentre";
    if (current === "pregame") return "card.watch";
    if (current === "live") return "card.watchNow";
    if (current === "postgame") return "card.watchCommentary";
    return match?.status === "ended" ? "card.summary" : "card.matchCentre";
  }

  return {
    PRE_MATCH_MINUTES,
    MATCH_WINDOW_MINUTES,
    POST_MATCH_MINUTES,
    TV_END_MINUTES,
    minutesFromKickoff,
    phase,
    isEligible,
    cardActionKey,
  };
});
