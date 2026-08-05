/**
 * Match status helpers — infer/demote from kickoff when provider data is missing
 * or cached snapshots go stale (e.g. WC fixtures still marked live weeks later).
 */

/** Wall-clock span we infer "live" without explicit provider status (90' + ET + pens). */
export const MAX_LIVE_INFER_MS = 3 * 60 * 60 * 1000;

export function parseKickoffMs(ts) {
  if (!ts) return NaN;
  const text = String(ts).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text) ? `${text}Z` : text;
  return Date.parse(normalized);
}

/** Infer upcoming/live/ended from kickoff when the provider has no status. */
export function kickoffInferStatus(kickoffRaw, fallback = "upcoming", nowMs = Date.now()) {
  const kickoff = typeof kickoffRaw === "number" ? kickoffRaw : parseKickoffMs(kickoffRaw);
  if (Number.isNaN(kickoff)) return fallback;
  const elapsed = nowMs - kickoff;
  if (elapsed < 0) return "upcoming";
  if (elapsed > MAX_LIVE_INFER_MS) return "ended";
  return "live";
}

/** Demote cached/API-less "live" when kickoff is far in the past. */
export function demoteStaleLive(status, kickoffRaw, nowMs = Date.now()) {
  if (status !== "live") return status;
  const kickoff = typeof kickoffRaw === "number" ? kickoffRaw : parseKickoffMs(kickoffRaw);
  if (Number.isNaN(kickoff)) return status;
  return nowMs - kickoff > MAX_LIVE_INFER_MS ? "ended" : status;
}

/** Correct status for cached today.json rows (refineStatus in data.js). */
export function refineCachedStatus(status, kickoffRaw, nowMs = Date.now()) {
  const demoted = demoteStaleLive(status, kickoffRaw, nowMs);
  if (demoted === "ended") return "ended";
  if (demoted === "live") return "live";
  return kickoffInferStatus(kickoffRaw, status, nowMs);
}
