/**
 * Match Intelligence: normalize genuine provider data. No synthetic probabilities.
 * Momentum sign follows Sportradar: negative => home, positive => away.
 */
export function goalMinute(clock) {
  const m = /^(\d{1,3})(?:\+(\d{1,2}))?/.exec(String(clock || "").trim());
  return m ? Number(m[1]) + Number(m[2] || 0) : null;
}

export function scoreProgress(goals = [], maxMinute = 90) {
  const safe = Array.isArray(goals) ? goals : [];
  const events = safe.map((g) => ({
    minute: goalMinute(g.minute || g.match_clock || g.match_time),
    side: g.side || g.competitor,
  })).filter((g) => g.minute !== null && (g.side === "home" || g.side === "away"))
    .sort((a, b) => a.minute - b.minute);
  const points = [{ minute: 0, home: 0, away: 0 }];
  let home = 0;
  let away = 0;
  for (const event of events) {
    if (event.side === "home") home++;
    else away++;
    points.push({ minute: event.minute, home, away });
  }
  points.push({ minute: Math.max(maxMinute, events.at(-1)?.minute || 0), home, away });
  return points;
}

export function normalizeMomentum(payload) {
  const entries = payload && (payload.momentum || payload.momentums || payload.timeline?.momentum);
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({
      minute: Number(entry.match_time),
      value: Number(entry.value),
      side: entry.competitor || (Number(entry.value) < 0 ? "home" : "away"),
    }))
    .filter((entry) => Number.isInteger(entry.minute) && entry.minute >= 0 && entry.minute <= 130 &&
      Number.isFinite(entry.value) && Math.abs(entry.value) <= 50)
    .sort((a, b) => a.minute - b.minute);
}

const EVENT_TYPES = new Set([
  "score_change", "goal", "own_goal", "penalty_kick", "yellow_card", "yellow_red_card",
  "red_card", "substitution", "shot_on_target", "shot_off_target", "shot_blocked",
  "possible_goal", "video_assistant_referee", "decision_to_var", "decision_to_var_over",
  "corner_kick", "period_start", "break_start", "match_ended",
]);

export function normalizeTimeline(payload) {
  const entries = payload && (payload.timeline || payload.events || []);
  if (!Array.isArray(entries)) return [];
  return entries.filter((item) => item && EVENT_TYPES.has(item.type))
    .map((entry) => ({
      id: String(entry.id || ""),
      type: entry.type,
      minute: Number.isFinite(Number(entry.match_time)) ? Number(entry.match_time) : goalMinute(entry.match_clock),
      clock: String(entry.match_clock || entry.match_time || ""),
      side: entry.competitor === "home" || entry.competitor === "away" ? entry.competitor : null,
      description: String(entry.description || "").slice(0, 180),
      player: String(entry.player?.name || "").slice(0, 100),
      x: Number.isFinite(Number(entry.x)) && entry.x != null ? Number(entry.x) : null,
      y: Number.isFinite(Number(entry.y)) && entry.y != null ? Number(entry.y) : null,
    })).filter((entry) => entry.minute !== null && Number.isFinite(entry.minute))
    .sort((a, b) => a.minute - b.minute).slice(-120);
}
