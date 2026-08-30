/**
 * Saudi Pro League picture is not on the beIN operator path yet.
 * Cards and the watch player must not promise "Watch now" until a
 * verified / operator stream plan exists for that ESPN id.
 */

const PLAYABLE_PLAN = new Set(["verified", "operator"]);

export function isSaudiProLeagueMatch(match = {}) {
  const competition = String(match.competition || "").toLowerCase();
  if (competition === "spl") return true;
  const slug = String(match.leagueSlug || "").toLowerCase();
  if (slug === "ksa.1") return true;
  const id = String(match.id || match.matchId || "");
  return id.includes("espn-ksa.1-");
}

export function saudiStreamComingSoon(match, plan) {
  if (!isSaudiProLeagueMatch(match)) return false;
  return !PLAYABLE_PLAN.has(String(plan?.status || ""));
}
