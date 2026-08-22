/**
 * Watch-page chrome under stream plans.
 * Channel grids, server pills, and 24/7 alt tabs are leftover World Cup UI.
 * They stay off unless the page is the IPTV admin player.
 */

const PLAN_HIDES_LEGACY = new Set(["operator", "verified", "waiting", "conflict", "pending"]);

export function allowLegacySourceChrome({ xtream = false, matchId = "", plan = null } = {}) {
  if (xtream) return true;
  if (matchId) return false;
  if (plan?.catalog) return false;
  if (plan && PLAN_HIDES_LEGACY.has(plan.status)) return false;
  return false;
}
