/* match-status.js — keep in sync with lib/match-status.js */
(function (global) {
  "use strict";

  const MAX_LIVE_INFER_MS = 3 * 60 * 60 * 1000;

  function parseKickoffMs(ts) {
    if (!ts) return NaN;
    const text = String(ts).trim();
    const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)
      ? `${text}Z`
      : text;
    return Date.parse(normalized);
  }

  function kickoffInferStatus(kickoffRaw, fallback, nowMs) {
    const fb = fallback === undefined ? "upcoming" : fallback;
    const now = nowMs === undefined ? Date.now() : nowMs;
    const kickoff = typeof kickoffRaw === "number" ? kickoffRaw : parseKickoffMs(kickoffRaw);
    if (Number.isNaN(kickoff)) return fb;
    const elapsed = now - kickoff;
    if (elapsed < 0) return "upcoming";
    if (elapsed > MAX_LIVE_INFER_MS) return "ended";
    return "live";
  }

  function demoteStaleLive(status, kickoffRaw, nowMs) {
    const now = nowMs === undefined ? Date.now() : nowMs;
    if (status !== "live") return status;
    const kickoff = typeof kickoffRaw === "number" ? kickoffRaw : parseKickoffMs(kickoffRaw);
    if (Number.isNaN(kickoff)) return status;
    return now - kickoff > MAX_LIVE_INFER_MS ? "ended" : status;
  }

  function refineCachedStatus(status, kickoffRaw, nowMs) {
    const now = nowMs === undefined ? Date.now() : nowMs;
    const demoted = demoteStaleLive(status, kickoffRaw, now);
    if (demoted === "ended") return "ended";
    if (demoted === "live") return "live";
    return kickoffInferStatus(kickoffRaw, status, now);
  }

  global.MatchStatus = {
    MAX_LIVE_INFER_MS,
    parseKickoffMs,
    kickoffInferStatus,
    demoteStaleLive,
    refineCachedStatus,
  };
})(window);
