/* ============================================================================
 * match-detail-lib.js — pre-match lineups + advanced live stats, sourced from
 * ESPN's site API (the same free, no-key hidden API already powering scores
 * and fixtures in this app — never a second, less-trusted source).
 *
 * Coverage note: this only works for matches whose id encodes an ESPN event
 * id (see normalizeEspnEvent in matches-lib.js). Fixtures that only came from
 * TheSportsDB have no ESPN event to look up, so they simply get no lineups/
 * stats — never a guess or a fallback to something less reliable.
 * ==========================================================================*/

/** "espn-fifa.world-760498" -> { leagueSlug: "fifa.world", eventId: "760498" }. */
function parseEspnMatchId(id) {
  const m = /^espn-(.+)-(\d+)$/.exec(id || "");
  return m ? { leagueSlug: m[1], eventId: m[2] } : null;
}

/** Curated, Arabic-labelled subset of ESPN's ~26 team stat categories. */
const STAT_DEFS = [
  { key: "possessionPct", labelAr: "الاستحواذ", percent: true },
  { key: "totalShots", labelAr: "التسديدات" },
  { key: "shotsOnTarget", labelAr: "تسديدات على المرمى" },
  { key: "wonCorners", labelAr: "الركلات الركنية" },
  { key: "foulsCommitted", labelAr: "الأخطاء" },
  { key: "offsides", labelAr: "التسلل" },
  { key: "yellowCards", labelAr: "البطاقات الصفراء" },
  { key: "redCards", labelAr: "البطاقات الحمراء" },
  { key: "totalPasses", labelAr: "التمريرات" },
  { key: "passPct", labelAr: "دقة التمرير", percent: true, rawIsFraction: true },
  { key: "totalTackles", labelAr: "التدخلات" },
  { key: "interceptions", labelAr: "الاعتراضات" },
  { key: "totalClearance", labelAr: "الإبعادات" },
  { key: "totalCrosses", labelAr: "العرضيات" },
  { key: "saves", labelAr: "التصديات" },
];

/** { home: {statKey: number}, away: {...} } | null when boxscore stats are missing. */
function extractMatchStats(summary) {
  const teams = (summary && summary.boxscore && summary.boxscore.teams) || [];
  const wanted = new Set(STAT_DEFS.map((d) => d.key));
  const rawIsFraction = new Set(STAT_DEFS.filter((d) => d.rawIsFraction).map((d) => d.key));
  const byHomeAway = {};
  for (const t of teams) {
    if (t.homeAway !== "home" && t.homeAway !== "away") continue;
    const map = {};
    for (const s of t.statistics || []) {
      if (!wanted.has(s.name)) continue;
      const v = parseFloat(s.displayValue);
      if (isNaN(v)) continue;
      map[s.name] = rawIsFraction.has(s.name) ? v * 100 : v;
    }
    byHomeAway[t.homeAway] = map;
  }
  if (!byHomeAway.home || !byHomeAway.away) return null;
  if (!Object.keys(byHomeAway.home).length && !Object.keys(byHomeAway.away).length) return null;
  return { home: byHomeAway.home, away: byHomeAway.away };
}

/** Broad tactical band from ESPN's position abbreviation — a catch-all "mid"
 * bucket keeps this correct-by-construction (every starter lands somewhere)
 * rather than a numeric-slot guess that can misplace a player. */
function bandForPosition(abbr) {
  const a = (abbr || "").toUpperCase();
  if (a === "G") return "gk";
  if (/^(CD|LB|RB|D)/.test(a)) return "def";
  if (/^(F|ST|CF|LF|RF|LW|RW)$/.test(a)) return "fwd";
  return "mid";
}

function playerEntry(p) {
  return {
    jersey: p.jersey || "",
    name: (p.athlete && (p.athlete.shortName || p.athlete.displayName)) || "",
    band: bandForPosition(p.position && p.position.abbreviation),
    position: (p.position && p.position.displayName) || "",
  };
}

/** { home: {formation, starters, subs}, away: {...} } | null when no rosters yet. */
function extractLineups(summary) {
  const rosters = (summary && summary.rosters) || [];
  const out = {};
  for (const r of rosters) {
    if (r.homeAway !== "home" && r.homeAway !== "away") continue;
    const roster = Array.isArray(r.roster) ? r.roster : [];
    const starters = roster.filter((p) => p.starter).map(playerEntry);
    const subs = roster.filter((p) => !p.starter).map(playerEntry);
    if (!starters.length) continue;
    out[r.homeAway] = { formation: r.formation || "", starters, subs };
  }
  if (!out.home || !out.away) return null;
  return out;
}

module.exports = {
  parseEspnMatchId,
  STAT_DEFS,
  extractMatchStats,
  bandForPosition,
  extractLineups,
};
