const PRIMARY_FIELDS = [
  "status",
  "seoEventStatus",
  "score",
  "kickoffUtc",
  "league",
  "leagueAr",
  "competition",
  "venue",
  "venueInfo",
  "homeTeamInfo",
  "awayTeamInfo",
  "homeRecord",
  "awayRecord",
  "headToHead",
  "recentForm",
  "lineups",
  "goals",
  "highlights",
  "highlight",
  "broadcasters",
  "channel",
  "commentator",
];

function clean(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(clean);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, clean(item)]),
    );
  }
  return value;
}

export function seoMatchKey(match) {
  if (match?.id) return `id:${match.id}`;
  return `fixture:${match?.kickoffUtc || ""}|${match?.home || ""}|${match?.away || ""}`;
}

export function seoPrimaryFingerprint(match) {
  const snapshot = {};
  for (const key of PRIMARY_FIELDS) {
    if (match?.[key] !== undefined) snapshot[key] = match[key];
  }
  return JSON.stringify(clean(snapshot));
}

function validObservedAt(value) {
  const parsed = Date.parse(value || "");
  return Number.isNaN(parsed) ? new Date(0).toISOString() : new Date(parsed).toISOString();
}

export function seedSeoMatches(matches, observedAt) {
  const stamp = validObservedAt(observedAt);
  return (Array.isArray(matches) ? matches : []).map((match) => ({
    ...match,
    seoLastmod: match.seoLastmod || stamp,
  }));
}

export function mergeSeoMatches(previousMatches, currentMatches, observedAt) {
  const stamp = validObservedAt(observedAt);
  const previous = new Map(
    (Array.isArray(previousMatches) ? previousMatches : []).map((match) => [seoMatchKey(match), match]),
  );

  for (const current of Array.isArray(currentMatches) ? currentMatches : []) {
    const key = seoMatchKey(current);
    const prior = previous.get(key);
    if (!prior) {
      previous.set(key, { ...current, seoLastmod: current.seoLastmod || stamp });
      continue;
    }

    const merged = { ...prior, ...current };
    const changed = seoPrimaryFingerprint(prior) !== seoPrimaryFingerprint(merged);
    merged.seoLastmod = changed ? stamp : prior.seoLastmod || stamp;
    previous.set(key, merged);
  }

  return [...previous.values()].sort((a, b) => {
    const at = Date.parse(a?.kickoffUtc || "");
    const bt = Date.parse(b?.kickoffUtc || "");
    if (Number.isNaN(at) && Number.isNaN(bt)) return seoMatchKey(a).localeCompare(seoMatchKey(b));
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;
    return at - bt;
  });
}

function firstLink(entity) {
  const links = entity?.links || [];
  return links.find((link) => link?.rel?.includes("clubhouse"))?.href || links[0]?.href || "";
}

function compactTeam(competitor, fallbackName) {
  const team = competitor?.team || {};
  const id = team.id || competitor?.id || "";
  const name = team.displayName || team.name || fallbackName || "";
  const url = firstLink(team) || firstLink(competitor);
  if (!id && !name && !url) return null;
  return { id: String(id || ""), name, url };
}

function headerCompetition(summary) {
  return summary?.header?.competitions?.[0] || null;
}

export function extractSeoTeamInfo(summary, match) {
  const competitors = headerCompetition(summary)?.competitors || [];
  const home = competitors.find((item) => item?.homeAway === "home") || competitors[0] || null;
  const away = competitors.find((item) => item?.homeAway === "away") || competitors[1] || null;
  return {
    homeTeamInfo: compactTeam(home, match?.home),
    awayTeamInfo: compactTeam(away, match?.away),
    homeRecord:
      home?.records?.find((record) => record?.type === "total")?.summary ||
      home?.records?.find((record) => record?.name === "All Splits")?.summary ||
      "",
    awayRecord:
      away?.records?.find((record) => record?.type === "total")?.summary ||
      away?.records?.find((record) => record?.name === "All Splits")?.summary ||
      "",
  };
}

export function extractSeoVenue(summary, fallbackVenue = "") {
  const venue = summary?.gameInfo?.venue || headerCompetition(summary)?.venue || null;
  if (!venue) {
    const [name, city, country] = String(fallbackVenue || "")
      .split("·")
      .map((value) => value.trim());
    if (!name) return null;
    return { name, city: city || "", country: country || "", streetAddress: "" };
  }
  const address = venue.address || {};
  return {
    id: String(venue.id || ""),
    name: venue.fullName || venue.shortName || venue.displayName || "",
    streetAddress: address.street || address.streetAddress || "",
    city: address.city || address.addressLocality || "",
    country: address.country || address.addressCountry || "",
  };
}

export function extractSeoBroadcasters(summary) {
  const seen = new Set();
  const rows = [];
  for (const item of summary?.broadcasts || []) {
    const name = item?.media?.shortName || item?.media?.name || item?.media?.callLetters || "";
    if (!name) continue;
    const row = {
      name,
      region: item?.region || "",
      type: item?.type?.shortName || item?.type?.longName || "",
      language: item?.lang || "",
    };
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}

export function extractSeoHeadToHead(summary) {
  const row = (summary?.seasonseries || []).find((item) => item?.type === "head-to-head");
  if (!row) return null;
  return {
    title: row.title || "",
    summary: row.summary || "",
    shortSummary: row.shortSummary || "",
    seriesScore: row.seriesScore || "",
    totalCompetitions: Number(row.totalCompetitions) || null,
  };
}

function compactFormEvent(event) {
  if (!event) return null;
  return {
    date: event.gameDate || "",
    result: event.gameResult || "",
    score: event.score || "",
    opponent: event.opponent?.displayName || "",
    competition: event.competitionName || event.leagueName || "",
  };
}

export function extractSeoRecentForm(summary) {
  const rows = summary?.lastFiveGames || [];
  if (!Array.isArray(rows) || !rows.length) return null;
  const byTeamId = {};
  for (const row of rows) {
    const id = String(row?.team?.id || "");
    if (!id) continue;
    byTeamId[id] = (row.events || []).map(compactFormEvent).filter(Boolean).slice(-5);
  }
  return Object.keys(byTeamId).length ? byTeamId : null;
}

export function attachSeoRecentForm(match, byTeamId) {
  if (!byTeamId) return null;
  const homeId = String(match?.homeTeamInfo?.id || "");
  const awayId = String(match?.awayTeamInfo?.id || "");
  const home = homeId ? byTeamId[homeId] || [] : [];
  const away = awayId ? byTeamId[awayId] || [] : [];
  if (!home.length && !away.length) return null;
  return { home, away };
}

export function mapSeoEventStatus(summary, fallbackStatus) {
  const type = headerCompetition(summary)?.status?.type || summary?.header?.competitions?.[0]?.status?.type || {};
  const name = String(type.name || "").toUpperCase();
  const state = String(type.state || "").toLowerCase();
  if (/POSTPON/.test(name)) return "EventPostponed";
  if (/CANCEL/.test(name)) return "EventCancelled";
  if (type.completed || state === "post" || fallbackStatus === "ended") return "EventCompleted";
  if (state === "in" || fallbackStatus === "live") return "EventInProgress";
  return "EventScheduled";
}

export function enrichSeoMatch(match, summary) {
  const teamInfo = extractSeoTeamInfo(summary, match);
  const enriched = {
    ...match,
    ...teamInfo,
    venueInfo: extractSeoVenue(summary, match?.venue),
    broadcasters: extractSeoBroadcasters(summary),
    headToHead: extractSeoHeadToHead(summary),
    seoEventStatus: mapSeoEventStatus(summary, match?.status),
  };
  const formByTeam = extractSeoRecentForm(summary);
  enriched.recentForm = attachSeoRecentForm(enriched, formByTeam);
  return enriched;
}
