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

/** Cards + substitutions from ESPN's play-by-play (keyEvents), keyed by athlete
 * id — this is what lets the pitch reflect who's actually on the field and
 * carded, not just the pre-match XI. Substitution participants are always
 * [incoming, outgoing]; card participants are the carded player. */
function extractMatchEvents(summary) {
  const events = (summary && summary.keyEvents) || [];
  const cardsByAthleteId = {};
  const subsByOutAthleteId = {};
  for (const e of events) {
    const type = (e.type && e.type.type) || "";
    const participants = e.participants || [];
    if (/yellow-card|red-card/.test(type)) {
      const athleteId = participants[0] && participants[0].athlete && participants[0].athlete.id;
      if (!athleteId) continue;
      const entry = cardsByAthleteId[athleteId] || { yellow: 0, red: 0 };
      if (/red-card/.test(type)) entry.red++;
      else entry.yellow++;
      cardsByAthleteId[athleteId] = entry;
    } else if (type === "substitution") {
      const inP = participants[0];
      const outP = participants[1];
      if (!inP || !outP || !outP.athlete || !inP.athlete) continue;
      subsByOutAthleteId[outP.athlete.id] = {
        inAthleteId: inP.athlete.id,
        minute: (e.clock && e.clock.displayValue) || "",
      };
    }
  }
  return { cardsByAthleteId, subsByOutAthleteId };
}

function playerEntry(p, cardsByAthleteId) {
  const athleteId = p.athlete && p.athlete.id;
  const cards = (athleteId && cardsByAthleteId && cardsByAthleteId[athleteId]) || { yellow: 0, red: 0 };
  const abbr = (p.position && p.position.abbreviation) || "";
  const fp = parseInt(p.formationPlace, 10);
  return {
    id: athleteId || "",
    jersey: p.jersey || "",
    name: (p.athlete && (p.athlete.shortName || p.athlete.displayName)) || "",
    band: bandForPosition(abbr),
    pos: abbr,
    formationPlace: isNaN(fp) ? null : fp,
    position: (p.position && p.position.displayName) || "",
    yellowCards: cards.yellow,
    redCards: cards.red,
  };
}

/** { home: {formation, starters, subs}, away: {...} } | null when no rosters yet.
 * `starters` reflects who is CURRENTLY on the pitch: a starter replaced by a
 * substitution event is swapped for the player who came on (keeping the
 * original's tactical band, since incoming subs carry no formation slot of
 * their own), tagged with who they replaced and when. */
function extractLineups(summary) {
  const rosters = (summary && summary.rosters) || [];
  const { cardsByAthleteId, subsByOutAthleteId } = extractMatchEvents(summary);
  const out = {};
  for (const r of rosters) {
    if (r.homeAway !== "home" && r.homeAway !== "away") continue;
    const roster = Array.isArray(r.roster) ? r.roster : [];
    const byAthleteId = {};
    roster.forEach((p) => { if (p.athlete && p.athlete.id) byAthleteId[p.athlete.id] = p; });

    const startersRaw = roster.filter((p) => p.starter);
    if (!startersRaw.length) continue;

    const starters = startersRaw.map((p) => {
      const outId = p.athlete && p.athlete.id;
      const sub = outId && subsByOutAthleteId[outId];
      const incomingRaw = sub && byAthleteId[sub.inAthleteId];
      if (!incomingRaw) return playerEntry(p, cardsByAthleteId);
      const outEntry = playerEntry(p, cardsByAthleteId);
      // Sub keeps the pitch slot (band/pos/formationPlace) of whoever they
      // replaced — incoming subs carry no formation slot of their own.
      return {
        ...playerEntry(incomingRaw, cardsByAthleteId),
        band: outEntry.band,
        pos: outEntry.pos,
        formationPlace: outEntry.formationPlace,
        subFor: outEntry.name,
        subMinute: sub.minute,
      };
    });
    const subs = roster.filter((p) => !p.starter).map((p) => playerEntry(p, cardsByAthleteId));
    out[r.homeAway] = { formation: r.formation || "", starters, subs };
  }
  if (!out.home || !out.away) return null;
  return out;
}

/** Maps ESPN team id -> "home"/"away" from the event header competitors. */
function teamSideById(summary) {
  const comp = summary && summary.header && summary.header.competitions && summary.header.competitions[0];
  const competitors = (comp && comp.competitors) || [];
  const map = {};
  for (const c of competitors) {
    const id = c.id || (c.team && c.team.id);
    if (id && (c.homeAway === "home" || c.homeAway === "away")) map[String(id)] = c.homeAway;
  }
  return map;
}

/** "Breel Embolo" -> "B. Embolo" (keeps single-word names as-is). */
function shortenName(full) {
  const parts = String(full || "").trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || "";
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/** Goal timeline from keyEvents: [{ side, scorer, minute, penalty, own }], time-ordered.
 * Own goals are credited to the opponent (football convention) and tagged. */
function extractGoals(summary) {
  const events = (summary && summary.keyEvents) || [];
  const sideById = teamSideById(summary);
  const rows = [];
  for (const e of events) {
    if (!e.scoringPlay) continue;
    const type = (e.type && e.type.type) || "";
    if (/shootout/.test(type)) continue; // shootout kicks are reflected in the final score, not the timeline
    const teamId = e.team && e.team.id ? String(e.team.id) : null;
    let side = teamId ? sideById[teamId] : null;
    const own = /own/.test(type);
    if (own && (side === "home" || side === "away")) side = side === "home" ? "away" : "home";
    if (side !== "home" && side !== "away") continue;
    const athlete = e.participants && e.participants[0] && e.participants[0].athlete;
    const scorer = shortenName(athlete && (athlete.shortName || athlete.displayName));
    const period = (e.period && e.period.number) || 0;
    const clockVal = e.clock && typeof e.clock.value === "number" ? e.clock.value : 0;
    rows.push({
      side,
      scorer,
      minute: (e.clock && e.clock.displayValue) || "",
      penalty: /penalty/.test(type),
      own,
      _order: period * 100000 + clockVal,
    });
  }
  rows.sort((a, b) => a._order - b._order);
  return rows.map(({ _order, ...g }) => g);
}

module.exports = {
  parseEspnMatchId,
  STAT_DEFS,
  extractMatchStats,
  bandForPosition,
  extractLineups,
  extractGoals,
  shortenName,
};
