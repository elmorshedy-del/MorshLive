export const SEO_COMPETITIONS = Object.freeze([
  { key: "epl", leagueSlug: "eng.1", name: "English Premier League", nameAr: "الدوري الإنجليزي الممتاز" },
  { key: "laliga", leagueSlug: "esp.1", name: "Spanish LALIGA", nameAr: "الدوري الإسباني" },
  { key: "spl", leagueSlug: "ksa.1", name: "Saudi Pro League", nameAr: "الدوري السعودي" },
  { key: "ucl", leagueSlug: "uefa.champions", name: "UEFA Champions League", nameAr: "دوري أبطال أوروبا" },
  { key: "ucl", leagueSlug: "uefa.champions_qual", name: "UEFA Champions League Qualifying", nameAr: "دوري أبطال أوروبا" },
]);

function cleanText(value) {
  return String(value || "").trim();
}

function competitionForSlug(slug) {
  return SEO_COMPETITIONS.find((item) => item.leagueSlug === slug) || null;
}

function firstEntityUrl(team) {
  const links = Array.isArray(team?.links) ? team.links : [];
  return links.find((link) => link?.rel?.includes("clubhouse"))?.href || "";
}

function compactTeam(competitor, fallbackName = "") {
  const team = competitor?.team || {};
  const id = cleanText(team.id || competitor?.id);
  const name = cleanText(team.displayName || team.name || fallbackName);
  if (!id && !name) return null;
  const url = firstEntityUrl(team);
  return { id, name, url };
}

function totalRecord(competitor) {
  const records = Array.isArray(competitor?.records) ? competitor.records : [];
  return cleanText(
    records.find((record) => record?.type === "total")?.summary ||
      records.find((record) => record?.name === "All Splits")?.summary,
  );
}

function eventType(competition) {
  return competition?.status?.type || {};
}

function pageStatus(competition) {
  const type = eventType(competition);
  const name = cleanText(type.name).toUpperCase();
  const state = cleanText(type.state).toLowerCase();
  if (/POSTPON|CANCEL/.test(name)) return "upcoming";
  if (type.completed || state === "post") return "ended";
  if (state === "in") return "live";
  return "upcoming";
}

/** Google Event documentation only supports scheduled/postponed/cancelled/rescheduled states. */
export function mapSeoEventStatus(source, fallback = "upcoming") {
  const competition = source?.header?.competitions?.[0] || source?.competitions?.[0] || source || {};
  const type = eventType(competition);
  const name = cleanText(type.name).toUpperCase();
  if (/POSTPON/.test(name)) return "EventPostponed";
  if (/CANCEL/.test(name)) return "EventCancelled";
  if (/RESCHED/.test(name)) return "EventRescheduled";
  // Live and completed matches remain the same scheduled event; the visible page
  // carries the live/final state. Do not emit unsupported EventInProgress/EventCompleted.
  void fallback;
  return "EventScheduled";
}

function venueInfo(competition, summary) {
  const venue = summary?.gameInfo?.venue || competition?.venue || null;
  if (!venue) return null;
  const address = venue.address || {};
  const out = {
    id: cleanText(venue.id),
    name: cleanText(venue.fullName || venue.displayName || venue.shortName),
    streetAddress: cleanText(address.streetAddress || address.street),
    city: cleanText(address.city || address.addressLocality),
    country: cleanText(address.country || address.addressCountry),
  };
  return out.name || out.city || out.country ? out : null;
}

function broadcasterRows(...collections) {
  const seen = new Set();
  const rows = [];
  for (const items of collections) {
    for (const item of Array.isArray(items) ? items : []) {
      const name = cleanText(item?.media?.shortName || item?.media?.name || item?.media?.callLetters || item?.name);
      if (!name) continue;
      const row = {
        name,
        region: cleanText(item?.region),
        type: cleanText(item?.type?.shortName || item?.type?.longName || item?.type),
        language: cleanText(item?.lang || item?.language),
      };
      const key = JSON.stringify(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}

function goalRows(details, competitors) {
  const teamSide = new Map(
    competitors
      .filter((item) => item?.id && (item.homeAway === "home" || item.homeAway === "away"))
      .map((item) => [String(item.id), item.homeAway]),
  );
  return (Array.isArray(details) ? details : [])
    .filter((detail) => detail?.scoringPlay && !detail?.shootout)
    .map((detail) => {
      const athlete = detail?.athletesInvolved?.[0] || detail?.participants?.[0]?.athlete || {};
      const teamId = cleanText(detail?.team?.id);
      return {
        side: teamSide.get(teamId) || "",
        scorer: cleanText(athlete.shortName || athlete.displayName),
        minute: cleanText(detail?.clock?.displayValue),
        penalty: Boolean(detail?.penaltyKick) || /penalty/i.test(cleanText(detail?.type?.text || detail?.type?.type)),
        own: Boolean(detail?.ownGoal) || /own goal/i.test(cleanText(detail?.type?.text || detail?.type?.type)),
      };
    })
    .filter((goal) => goal.scorer || goal.minute);
}

function scoreFor(competition, status) {
  if (status === "upcoming") return "VS";
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const home = competitors.find((item) => item?.homeAway === "home") || competitors[0];
  const away = competitors.find((item) => item?.homeAway === "away") || competitors[1];
  if (home?.score == null || away?.score == null) return "—";
  return `${home.score} - ${away.score}`;
}

export function normalizeSeoScoreboardEvent(event, leagueSlug) {
  const competitionMeta = competitionForSlug(leagueSlug);
  if (!competitionMeta) return null;
  const competition = event?.competitions?.[0] || {};
  const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
  const home = competitors.find((item) => item?.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((item) => item?.homeAway === "away") || competitors[1] || {};
  const homeTeam = home.team || {};
  const awayTeam = away.team || {};
  const status = pageStatus(competition);
  const kickoffUtc = cleanText(competition.date || event?.date);
  if (!kickoffUtc || !homeTeam.displayName || !awayTeam.displayName) return null;

  return {
    id: `espn-${leagueSlug}-${event.id}`,
    espnEventId: cleanText(event.id),
    status,
    seoEventStatus: mapSeoEventStatus(competition, status),
    minute: status === "live" ? cleanText(competition?.status?.displayClock || eventType(competition).shortDetail) : "",
    home: cleanText(homeTeam.displayName || homeTeam.name),
    away: cleanText(awayTeam.displayName || awayTeam.name),
    homeAbbr: cleanText(homeTeam.abbreviation),
    awayAbbr: cleanText(awayTeam.abbreviation),
    homeBadge: cleanText(homeTeam.logo),
    awayBadge: cleanText(awayTeam.logo),
    homeTeamInfo: compactTeam(home, homeTeam.displayName),
    awayTeamInfo: compactTeam(away, awayTeam.displayName),
    homeRecord: totalRecord(home),
    awayRecord: totalRecord(away),
    score: scoreFor(competition, status),
    kickoffUtc,
    league: competitionMeta.name,
    leagueAr: competitionMeta.nameAr,
    leagueSlug,
    competition: competitionMeta.key,
    venueInfo: venueInfo(competition),
    venue: [competition?.venue?.fullName, competition?.venue?.address?.city, competition?.venue?.address?.country]
      .filter(Boolean)
      .join(" · "),
    broadcasters: broadcasterRows(competition.geoBroadcasts, competition.broadcasts),
    goals: goalRows(competition.details, competitors),
    channel: null,
    channelId: null,
    commentator: null,
    source: "espn",
  };
}

function summaryCompetition(summary) {
  return summary?.header?.competitions?.[0] || {};
}

function recentForm(summary, match) {
  const rows = Array.isArray(summary?.lastFiveGames) ? summary.lastFiveGames : [];
  const byId = new Map();
  for (const row of rows) {
    const id = cleanText(row?.team?.id);
    if (!id) continue;
    byId.set(
      id,
      (Array.isArray(row.events) ? row.events : []).slice(-5).map((event) => ({
        date: cleanText(event.gameDate),
        result: cleanText(event.gameResult),
        score: cleanText(event.score),
        opponent: cleanText(event?.opponent?.displayName),
        competition: cleanText(event.competitionName || event.leagueName),
      })),
    );
  }
  const home = byId.get(cleanText(match?.homeTeamInfo?.id)) || [];
  const away = byId.get(cleanText(match?.awayTeamInfo?.id)) || [];
  return home.length || away.length ? { home, away } : null;
}

function headToHead(summary) {
  const row = (Array.isArray(summary?.seasonseries) ? summary.seasonseries : []).find(
    (item) => item?.type === "head-to-head",
  );
  if (!row) return null;
  return {
    summary: cleanText(row.summary),
    seriesScore: cleanText(row.seriesScore),
    totalCompetitions: Number(row.totalCompetitions) || null,
  };
}

function officialLineups(summary) {
  const rosters = Array.isArray(summary?.rosters) ? summary.rosters : [];
  const out = {};
  for (const roster of rosters) {
    if (roster?.homeAway !== "home" && roster?.homeAway !== "away") continue;
    const players = Array.isArray(roster.roster) ? roster.roster : [];
    const starters = players
      .filter((player) => player?.starter)
      .map((player) => ({ name: cleanText(player?.athlete?.shortName || player?.athlete?.displayName) }))
      .filter((player) => player.name);
    // Never treat an ordinary squad list as an expected XI.
    if (starters.length < 11) continue;
    out[roster.homeAway] = { formation: cleanText(roster.formation), starters };
  }
  return out.home && out.away ? out : null;
}

export function enrichSeoMatchFromSummary(match, summary) {
  if (!match || !summary) return match;
  const competition = summaryCompetition(summary);
  const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
  const home = competitors.find((item) => item?.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((item) => item?.homeAway === "away") || competitors[1] || {};
  const status = pageStatus(competition);
  const result = {
    ...match,
    status,
    seoEventStatus: mapSeoEventStatus(competition, status),
    minute: status === "live" ? cleanText(competition?.status?.displayClock || eventType(competition).shortDetail) : "",
    score: scoreFor(competition, status),
    homeTeamInfo: compactTeam(home, match.home) || match.homeTeamInfo,
    awayTeamInfo: compactTeam(away, match.away) || match.awayTeamInfo,
    homeRecord: totalRecord(home) || match.homeRecord,
    awayRecord: totalRecord(away) || match.awayRecord,
    venueInfo: venueInfo(competition, summary) || match.venueInfo,
    broadcasters: broadcasterRows(summary.broadcasts, competition.geoBroadcasts, competition.broadcasts).length
      ? broadcasterRows(summary.broadcasts, competition.geoBroadcasts, competition.broadcasts)
      : match.broadcasters,
    headToHead: headToHead(summary),
    recentForm: recentForm(summary, { ...match, homeTeamInfo: compactTeam(home, match.home), awayTeamInfo: compactTeam(away, match.away) }),
  };
  const lineups = officialLineups(summary);
  if (lineups) result.lineups = lineups;
  const goals = goalRows(summary.keyEvents || competition.details, competitors);
  if (goals.length) result.goals = goals;
  return result;
}

export function mergeKnownMatchData(match, known) {
  if (!known) return match;
  const fields = [
    "channel",
    "channelId",
    "commentator",
    "commentators",
    "highlights",
    "highlight",
    "clips",
    "summaryAr",
    "lineups",
    "stats",
    "goals",
  ];
  const out = { ...match };
  for (const field of fields) {
    if (known[field] != null && (Array.isArray(known[field]) ? known[field].length : true)) out[field] = known[field];
  }
  return out;
}
