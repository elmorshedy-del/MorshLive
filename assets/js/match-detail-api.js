/* Live lineups + stats from ESPN summary API (browser). Mirrors match-detail-lib.js. */
(function (global) {
  "use strict";

  const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
  const FETCH_TIMEOUT_MS = 8000;
  const _cache = new Map();

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

  function parseEspnMatchId(id) {
    const m = /^espn-(.+)-(\d+)$/.exec(id || "");
    return m ? { leagueSlug: m[1], eventId: m[2] } : null;
  }

  function detailTtl(match) {
    if (!match) return 5 * 60 * 1000;
    if (match.status === "live") return 60 * 1000;
    if (match.status === "upcoming") return 3 * 60 * 1000;
    return 10 * 60 * 1000;
  }

  function shouldFetchDetail(match) {
    if (!parseEspnMatchId(match && match.id)) return false;
    if (match.status === "live" || match.status === "upcoming") return true;
    if (match.status === "ended" && (!match.lineups || !match.stats)) return true;
    return false;
  }

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

  function bandForPosition(abbr) {
    const a = (abbr || "").toUpperCase();
    if (a === "G") return "gk";
    if (/^(CD|LB|RB|D)/.test(a)) return "def";
    if (/^(F|ST|CF|LF|RF|LW|RW)$/.test(a)) return "fwd";
    return "mid";
  }

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

  function shortenName(full) {
    const parts = String(full || "").trim().split(/\s+/);
    if (parts.length < 2) return parts[0] || "";
    return parts[0][0] + ". " + parts.slice(1).join(" ");
  }

  function extractGoals(summary) {
    const events = (summary && summary.keyEvents) || [];
    const sideById = teamSideById(summary);
    const rows = [];
    for (const e of events) {
      if (!e.scoringPlay) continue;
      const type = (e.type && e.type.type) || "";
      if (/shootout/.test(type)) continue;
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
    return rows.map((g) => ({ side: g.side, scorer: g.scorer, minute: g.minute, penalty: g.penalty, own: g.own }));
  }

  async function fetchSummary(match) {
    const parsed = parseEspnMatchId(match.id);
    if (!parsed) return null;
    const url = `${ESPN_BASE}/${parsed.leagueSlug}/summary?event=${parsed.eventId}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error("ESPN " + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchDetail(match, { force } = {}) {
    if (!shouldFetchDetail(match)) return _cache.get(match.id) || null;
    const ttl = detailTtl(match);
    const hit = _cache.get(match.id);
    if (!force && hit && Date.now() - hit.at < ttl) return hit;

    try {
      const summary = await fetchSummary(match);
      const detail = {
        at: Date.now(),
        lineups: extractLineups(summary),
        stats: extractMatchStats(summary),
        goals: extractGoals(summary),
      };
      _cache.set(match.id, detail);
      return detail;
    } catch (e) {
      if (hit) return hit;
      return null;
    }
  }

  function mergeDetail(match, detail) {
    if (!detail) return match;
    const out = { ...match };
    if (detail.lineups) out.lineups = detail.lineups;
    if (detail.stats) out.stats = detail.stats;
    if (detail.goals) out.goals = detail.goals;
    return out;
  }

  async function enrichMatch(match, opts) {
    const detail = await fetchDetail(match, opts);
    return mergeDetail(match, detail);
  }

  async function enrichMatches(matches, opts) {
    if (!Array.isArray(matches) || !matches.length) return matches;
    const targets = matches.filter(shouldFetchDetail);
    if (!targets.length) return matches;

    const settled = await Promise.allSettled(
      targets.map((m) => enrichMatch(m, opts))
    );

    const byId = new Map();
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") byId.set(targets[i].id, r.value);
    });

    return matches.map((m) => byId.get(m.id) || m);
  }

  global.MatchDetailAPI = {
    parseEspnMatchId,
    fetchDetail,
    enrichMatch,
    enrichMatches,
    shouldFetchDetail,
  };
})(window);
