/**
 * ESPN's soccer scoreboard stopped accepting a `dates` range.
 * Measured against site.api.espn.com on 2026-09-16, same connection, same
 * User-Agent (`curl/8.5.0`, the one the adapter already prefers):
 *
 *   ?dates=20260916            -> 200
 *   ?dates=202609              -> 200   (the whole month)
 *   ?dates=20260915-20260923   -> 400   {"code":400,"message":"Failed to get events endpoint."}
 *
 * Every caller asks for a window of a few days, so every league call 400'd at
 * once. The adapter only re-tries 401/403, so a 400 fell straight through:
 * getFootballScoreboards saw all five leagues rejected, threw "Football
 * scoreboards unavailable", and /api/football/scoreboard answered 500. The
 * browser's own ESPN fallback got the identical 400, so the homepage dropped to
 * the committed today.json — which is written by the same broken range call and
 * had gone stale — and rendered no cards at all.
 *
 * Ask for the month(s) the window spans instead (one request per month, so a
 * normal -1..+7 day window is still a single request) and keep only the days
 * that were actually asked for. Callers get the same payload shape, the same
 * events, in the same order as the range used to return.
 */

const COMPACT_RANGE = /^(\d{8})-(\d{8})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A range wider than this is not a scoreboard window; send it untouched. */
const MAX_MONTHS = 3;

/** "20260916" -> epoch ms at UTC midnight, NaN when it is not a compact day. */
export function parseCompactDay(value) {
  const text = String(value || "");
  if (!/^\d{8}$/.test(text)) return NaN;
  return Date.parse(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00Z`);
}

/** Epoch ms -> "YYYYMM", the only multi-day form ESPN still answers. */
export function monthKey(ms) {
  return new Date(ms).toISOString().slice(0, 7).replace("-", "");
}

/**
 * Translate a `dates` value into the months to request plus the window to keep.
 * Returns null for anything that is not a compact range — a single day and a
 * month are still served as-is, so they are passed through untouched.
 */
export function espnScoreboardWindow(dates) {
  const match = COMPACT_RANGE.exec(String(dates || ""));
  if (!match) return null;

  const startMs = parseCompactDay(match[1]);
  const endMs = parseCompactDay(match[2]);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;

  const months = [];
  // Walk month by month from the first of the start month so a window that
  // straddles a boundary (20260828-20260905) asks for both.
  const cursor = new Date(startMs);
  cursor.setUTCDate(1);
  while (cursor.getTime() <= endMs && months.length < MAX_MONTHS) {
    months.push(monthKey(cursor.getTime()));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  if (!months.length || cursor.getTime() <= endMs) return null;

  // ESPN buckets a scoreboard day by its UTC date, so the window runs to the
  // end of the last day asked for.
  return { startMs, endMs: endMs + DAY_MS, months };
}

/** Kickoff instant of an ESPN event, NaN when it carries no usable date. */
export function eventKickoffMs(event) {
  const competition = event && Array.isArray(event.competitions) ? event.competitions[0] : null;
  const raw = event?.date || competition?.date || "";
  return Date.parse(raw);
}

/** Events with no readable date are kept — dropping them would lose fixtures. */
export function eventInWindow(event, window) {
  if (!window) return true;
  const kickoff = eventKickoffMs(event);
  if (!Number.isFinite(kickoff)) return true;
  return kickoff >= window.startMs && kickoff < window.endMs;
}

/**
 * Fold the month payloads back into the single scoreboard the range returned:
 * the first payload's league metadata, its events narrowed to the window,
 * de-duplicated by id and ordered by kickoff.
 */
export function mergeScoreboardPayloads(payloads, window) {
  const list = (Array.isArray(payloads) ? payloads : []).filter((p) => p && typeof p === "object");
  const base = list[0] || {};
  const events = [];
  const seen = new Set();

  for (const payload of list) {
    const rows = Array.isArray(payload.events) ? payload.events : [];
    for (const event of rows) {
      const id = event && event.id != null ? String(event.id) : "";
      if (id && seen.has(id)) continue;
      if (!eventInWindow(event, window)) continue;
      if (id) seen.add(id);
      events.push(event);
    }
  }

  events.sort((a, b) => {
    const at = eventKickoffMs(a);
    const bt = eventKickoffMs(b);
    if (!Number.isFinite(at) || !Number.isFinite(bt)) return 0;
    return at - bt;
  });

  return { ...base, events };
}
