/**
 * When to execute or arm the match-day bind loop.
 *
 * User can ask for “today and tomorrow”: cover remaining EPL / La Liga
 * fixtures in that UTC window. One timer per ESPN id (T-15, then T-7,
 * then kickoff). If T-15 was missed, start that pass as soon as you can.
 * Do not arm a finished match.
 */

export const BIND_HORIZON_DAYS = 2;
export const BIND_MATCH_MINUTES = 150;
export const BIND_T15_MINUTES = 15;
export const BIND_T7_MINUTES = 7;

export function minutesUntilKickoff(kickoffUtc, now = Date.now()) {
  const kick = Date.parse(kickoffUtc);
  const at = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(kick) || !Number.isFinite(at)) return Number.NaN;
  return (kick - at) / 60000;
}

/**
 * @returns {null | { check: "t15"|"t7"|"kickoff", executeNow: boolean, fireAt: number }}
 */
export function bindActionForMatch({ kickoffUtc, now = Date.now() } = {}) {
  const mins = minutesUntilKickoff(kickoffUtc, now);
  if (!Number.isFinite(mins)) return null;
  if (mins < -BIND_MATCH_MINUTES) return null;
  if (mins > BIND_HORIZON_DAYS * 24 * 60) return null;
  const kick = Date.parse(kickoffUtc);
  if (mins > BIND_T15_MINUTES) {
    return { check: "t15", executeNow: false, fireAt: kick - BIND_T15_MINUTES * 60000 };
  }
  if (mins > BIND_T7_MINUTES)
    return { check: "t15", executeNow: true, fireAt: kick - BIND_T15_MINUTES * 60000 };
  if (mins > 0) return { check: "t7", executeNow: true, fireAt: kick - BIND_T7_MINUTES * 60000 };
  return { check: "kickoff", executeNow: true, fireAt: kick };
}

export function planBindLoop(matches = [], now = Date.now()) {
  const executeNow = [];
  const arm = [];
  for (const match of matches) {
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
