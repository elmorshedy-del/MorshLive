/**
 * Optional match-day preflight schedule for deterministic TV binding.
 *
 * Runtime binding no longer depends on an AI T-15/T-7 loop: the browser
 * resolves broadcaster -> catalog deterministically throughout the TV window.
 * This helper remains for batch/manual preflight work. Arm one check at T-30
 * (the normal pre-match studio window) and re-evaluate immediately if that
 * check was missed. Kickoff remains a final safety check.
 */

export const BIND_COMPETITION_KEYS = Object.freeze(["epl", "laliga", "spl", "ucl"]);
export const BIND_LEAGUE_SLUGS = Object.freeze([
  "eng.1",
  "esp.1",
  "ksa.1",
  "uefa.champions",
  "uefa.champions_qual",
]);

export function isBindLeagueMatch(match = {}) {
  const competition = String(match.competition || "").toLowerCase();
  if (BIND_COMPETITION_KEYS.includes(competition)) return true;
  const slug = String(match.leagueSlug || "").toLowerCase();
  if (BIND_LEAGUE_SLUGS.includes(slug)) return true;
  const id = String(match.matchId || match.id || "");
  return BIND_LEAGUE_SLUGS.some((league) => id.includes(`espn-${league}-`));
}

export const BIND_HORIZON_DAYS = 2;
export const BIND_MATCH_MINUTES = 165;
export const BIND_PREMATCH_MINUTES = 30;

export function minutesUntilKickoff(kickoffUtc, now = Date.now()) {
  const kick = Date.parse(kickoffUtc);
  const at = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(kick) || !Number.isFinite(at)) return Number.NaN;
  return (kick - at) / 60000;
}

/**
 * @returns {null | { check: "prematch"|"kickoff", executeNow: boolean, fireAt: number }}
 */
export function bindActionForMatch({ kickoffUtc, now = Date.now() } = {}) {
  const mins = minutesUntilKickoff(kickoffUtc, now);
  if (!Number.isFinite(mins)) return null;
  if (mins < -BIND_MATCH_MINUTES) return null;
  if (mins > BIND_HORIZON_DAYS * 24 * 60) return null;
  const kick = Date.parse(kickoffUtc);
  const prematchAt = kick - BIND_PREMATCH_MINUTES * 60000;
  if (mins > BIND_PREMATCH_MINUTES) {
    return { check: "prematch", executeNow: false, fireAt: prematchAt };
  }
  if (mins > 0) return { check: "prematch", executeNow: true, fireAt: prematchAt };
  return { check: "kickoff", executeNow: true, fireAt: kick };
}

export function planBindLoop(matches = [], now = Date.now()) {
  const executeNow = [];
  const arm = [];
  for (const match of matches) {
    if (!isBindLeagueMatch(match)) continue;
    const action = bindActionForMatch({ kickoffUtc: match.kickoffUtc, now });
    if (!action) continue;
    const row = {
      matchId: match.matchId || match.id,
      home: match.home,
      away: match.away,
      kickoffUtc: match.kickoffUtc,
      ...action,
    };
    if (action.executeNow) executeNow.push(row);
    else arm.push(row);
  }
  return { executeNow, arm };
}
