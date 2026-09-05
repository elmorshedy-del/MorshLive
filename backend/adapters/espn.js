const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/**
 * ESPN's edge decides by User-Agent, and the answer is not the obvious one.
 * Measured against site.api.espn.com on 2026-09-05:
 *
 *   curl/8.5.0                            -> 200
 *   curl/7.68.0                           -> 200
 *   KoraZero/1.0 football-match-centre    -> 403 Access Denied
 *   Mozilla/5.0 ... Chrome/120            -> 403 Access Denied
 *   "x" / empty                           -> 403 Access Denied
 *
 * The old custom UA sat squarely in the blocked class, so every league fetch
 * 403'd, getFootballScoreboards threw "scoreboards unavailable", and
 * /api/football/scoreboard answered 500. With no live fixtures the site fell
 * back to a committed today.json, which then went stale — and a stale fixture
 * list cannot be joined against today's broadcast source, so every match lost
 * its channel and defaulted to beIN Sports 1.
 *
 * Rather than pin one string and hope, try each in turn and remember the one
 * that worked. If ESPN flips its rule again the next cold start re-discovers a
 * working agent instead of taking the whole match feed down.
 */
const USER_AGENT_CANDIDATES = Object.freeze([
  "curl/8.5.0",
  "curl/7.68.0",
  "KoraZero/1.0 football-match-centre",
]);

let preferredUserAgent = null;

/** Exposed for tests; also lets a deploy start from a clean slate. */
export function resetEspnUserAgent() {
  preferredUserAgent = null;
}

function agentOrder() {
  if (!preferredUserAgent) return USER_AGENT_CANDIDATES;
  return [preferredUserAgent, ...USER_AGENT_CANDIDATES.filter((ua) => ua !== preferredUserAgent)];
}

async function fetchEspnJson(path, { fetchImpl = fetch } = {}) {
  let lastStatus = 0;
  for (const userAgent of agentOrder()) {
    const res = await fetchImpl(`${ESPN_BASE}/${path}`, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
    });
    if (res.ok) {
      preferredUserAgent = userAgent;
      return res.json();
    }
    lastStatus = res.status;
    // Only an access denial is worth retrying with a different agent. A 404 or
    // a 5xx is about the request or ESPN itself and will not change.
    if (res.status !== 403 && res.status !== 401) break;
    if (preferredUserAgent === userAgent) preferredUserAgent = null;
  }
  throw new Error(`ESPN upstream ${lastStatus}`);
}

export function fetchEspnScoreboard(slug, dates, options) {
  const params = new URLSearchParams({ dates, limit: "100" });
  return fetchEspnJson(`${slug}/scoreboard?${params.toString()}`, options);
}

export function fetchEspnSummary(slug, eventId, options) {
  const params = new URLSearchParams({ event: eventId });
  return fetchEspnJson(`${slug}/summary?${params.toString()}`, options);
}
