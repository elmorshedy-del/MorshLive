/* Shared normalization for Node (fetch-matches.js) — keep in sync with matches-api.js */
const LIVE = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "IN PLAY", "INT"]);
const ENDED = new Set(["FT", "AET", "PEN", "Match Finished", "AWD", "WO", "CANC", "ABD", "PST"]);
const MATCH_WINDOW_MS = 135 * 60 * 1000;
const RECENT_ENDED_MS = 18 * 60 * 60 * 1000;

const COMPETITIONS = Object.freeze([
  {
    key: "epl",
    name: "English Premier League",
    nameAr: "الدوري الإنجليزي الممتاز",
    espnSlugs: ["eng.1"],
    leagueNames: ["English Premier League"],
  },
  {
    key: "laliga",
    name: "Spanish LALIGA",
    nameAr: "الدوري الإسباني",
    espnSlugs: ["esp.1"],
    leagueNames: ["Spanish La Liga", "Spanish LALIGA", "LaLiga"],
  },
  {
    key: "spl",
    name: "Saudi Pro League",
    nameAr: "الدوري السعودي",
    espnSlugs: ["ksa.1"],
    leagueNames: [
      "Saudi Pro League",
      "Saudi-Arabian Pro League",
      "Saudi Professional League",
      "Roshn Saudi League",
    ],
  },
  {
    key: "ucl",
    name: "UEFA Champions League",
    nameAr: "دوري أبطال أوروبا",
    espnSlugs: ["uefa.champions", "uefa.champions_qual"],
    leagueNames: ["UEFA Champions League", "UEFA Champions League Qualifying"],
  },
]);
const ESPN_LEAGUES = Object.freeze(COMPETITIONS.flatMap((competition) => competition.espnSlugs));

function competitionForEspnSlug(slug) {
  const wanted = String(slug || "").toLowerCase();
  return COMPETITIONS.find((competition) => competition.espnSlugs.includes(wanted)) || null;
}

function competitionForLeagueName(name) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return null;
  return COMPETITIONS.find((competition) =>
    competition.leagueNames.some((leagueName) => leagueName.toLowerCase() === wanted)
  ) || null;
}

function isSupportedLeagueName(name) {
  return competitionForLeagueName(name) != null;
}

function abbr(name) {
  return (name || "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function parseKickoffMs(ts) {
  if (!ts) return NaN;
  const text = String(ts).trim();
  // TheSportsDB timestamps are UTC but are often returned without a timezone.
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)
    ? `${text}Z`
    : text;
  return Date.parse(normalized);
}

const MAX_LIVE_INFER_MS = 3 * 60 * 60 * 1000; // keep in sync with lib/match-status.js

/** Infer upcoming/live/ended from kickoff when the provider has no status. */
function kickoffInferStatus(ts, fallback) {
  const kickoff = parseKickoffMs(ts);
  if (isNaN(kickoff)) return fallback;
  const elapsed = Date.now() - kickoff;
  if (elapsed < 0) return "upcoming";
  if (elapsed > MAX_LIVE_INFER_MS) return "ended";
  return "live";
}

function demoteStaleLive(status, kickoffUtc, now = Date.now()) {
  if (status !== "live") return status;
  const kickoff = parseKickoffMs(kickoffUtc);
  if (isNaN(kickoff)) return status;
  return now - kickoff > MAX_LIVE_INFER_MS ? "ended" : status;
}

function statusOf(strStatus, strTimestamp) {
  const s = (strStatus || "").trim();
  if (!s || s === "NS" || /not started/i.test(s)) {
    return kickoffInferStatus(strTimestamp, "upcoming");
  }
  if (ENDED.has(s) || /^FT/i.test(s)) return "ended";
  if (LIVE.has(s) || /^\d+$/.test(s) || /'/.test(s) || /half/i.test(s)) {
    return "live";
  }
  return kickoffInferStatus(strTimestamp, "upcoming");
}

function formatScore(hs, as, status) {
  if (status === "upcoming") return "VS";
  const has = hs != null && hs !== "" && as != null && as !== "";
  if (has) return `${hs} - ${as}`;
  return "—";
}

function formatTime(e) {
  if (e.strTimeLocal) return e.strTimeLocal.slice(0, 5);
  if (e.strTime) return e.strTime.slice(0, 5);
  if (e.strTimestamp) {
    const kickoff = parseKickoffMs(e.strTimestamp);
    if (!isNaN(kickoff)) return new Date(kickoff).toISOString().slice(11, 16);
  }
  return "—";
}

function normalizeEvent(e) {
  const status = statusOf(e.strStatus, e.strTimestamp);
  const competition = competitionForLeagueName(e.strLeague);
  return {
    id: "e" + e.idEvent,
    status,
    minute: status === "live" ? (e.strProgress || e.strStatus || "مباشر") : "",
    home: e.strHomeTeam,
    away: e.strAwayTeam,
    homeAbbr: abbr(e.strHomeTeam),
    awayAbbr: abbr(e.strAwayTeam),
    homeBadge: e.strHomeTeamBadge || "",
    awayBadge: e.strAwayTeamBadge || "",
    score: formatScore(e.intHomeScore, e.intAwayScore, status),
    time: formatTime(e),
    kickoffUtc: e.strTimestamp || null,
    league: e.strLeague || "مباراة",
    leagueAr: competition ? competition.nameAr : "",
    leagueSlug: null,
    competition: competition ? competition.key : "",
    venue: [e.strVenue, e.strCity].filter(Boolean).join(" · "),
    channel: null,
    channelId: "bein-sports-1",
    commentator: null,
    source: "thesportsdb",
  };
}

function espnStatus(status, kickoffUtc) {
  const type = status && status.type ? status.type : {};
  const state = (type.state || "").toLowerCase();
  if (type.completed || state === "post") return "ended";
  if (state === "in") return "live";
  return kickoffInferStatus(kickoffUtc, "upcoming");
}

function normalizeEspnEvent(e, league) {
  const competition = e.competitions && e.competitions[0] ? e.competitions[0] : {};
  const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
  const home = competitors.find((c) => c.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((c) => c.homeAway === "away") || competitors[1] || {};
  const homeTeam = home.team || {};
  const awayTeam = away.team || {};
  const kickoffUtc = competition.date || e.date || null;
  const status = espnStatus(competition.status, kickoffUtc);
  const statusType = competition.status && competition.status.type ? competition.status.type : {};
  const leagueSlug = (league && league.slug) || "";
  const competitionMeta = competitionForEspnSlug(leagueSlug);

  return {
    id: `espn-${leagueSlug || "soccer"}-${e.id}`,
    status,
    minute: status === "live" ? (competition.status && (competition.status.displayClock || statusType.shortDetail || statusType.detail)) || "مباشر" : "",
    home: homeTeam.displayName || homeTeam.name || e.name,
    away: awayTeam.displayName || awayTeam.name || "",
    homeAbbr: homeTeam.abbreviation || abbr(homeTeam.displayName || homeTeam.name),
    awayAbbr: awayTeam.abbreviation || abbr(awayTeam.displayName || awayTeam.name),
    homeBadge: homeTeam.logo || "",
    awayBadge: awayTeam.logo || "",
    score: formatScore(home.score, away.score, status),
    time: kickoffUtc ? new Date(parseKickoffMs(kickoffUtc)).toISOString().slice(11, 16) : "—",
    kickoffUtc,
    league: (league && league.name) || (competitionMeta && competitionMeta.name) || competition.altGameNote || "مباراة",
    leagueAr: competitionMeta ? competitionMeta.nameAr : "",
    leagueSlug,
    competition: competitionMeta ? competitionMeta.key : "",
    venue: [
      competition.venue && competition.venue.fullName,
      competition.venue && competition.venue.address && competition.venue.address.city,
      competition.venue && competition.venue.address && competition.venue.address.country,
    ].filter(Boolean).join(" · "),
    channel: null,
    channelId: "bein-sports-1",
    commentator: null,
    source: "espn",
  };
}

// The site is Arabic-first for a MENA audience, so "today" is the day in Gulf
// time (UTC+3), not UTC. Bucketing a match by its raw UTC date put late-night
// games (e.g. a 22:00 UTC kickoff = 01:00 next day in MENA) on the wrong day —
// they showed up under "yesterday". Anchor every "which day" decision here.
const ARABIA_TZ_OFFSET_HOURS = 3;

/** ISO day (YYYY-MM-DD) of a UTC kickoff in MENA time. "" for invalid input. */
function arabiaDayIso(utcIso, offsetHours = ARABIA_TZ_OFFSET_HOURS) {
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms + offsetHours * 3600000).toISOString().slice(0, 10);
}

/** Today's ISO day in MENA time. */
function arabiaTodayIso(nowMs = Date.now(), offsetHours = ARABIA_TZ_OFFSET_HOURS) {
  return new Date(nowMs + offsetHours * 3600000).toISOString().slice(0, 10);
}

function canonical(text) {
  return (text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function matchKey(m) {
  const kickoff = parseKickoffMs(m.kickoffUtc);
  const day = isNaN(kickoff) ? "" : new Date(kickoff).toISOString().slice(0, 10);
  return [day, canonical(m.home), canonical(m.away)].join("|");
}

function hasScore(m) {
  return !!(m && m.score && m.score !== "VS" && m.score !== "—");
}

function mergeMatch(existing, incoming) {
  const merged = { ...existing };
  if (!String(existing.id || "").startsWith("espn-") && String(incoming.id || "").startsWith("espn-")) {
    merged.id = incoming.id;
  }
  if (incoming.status === "live") merged.status = "live";
  else if (incoming.status === "ended") merged.status = "ended";
  else if (existing.status === "upcoming") merged.status = incoming.status;
  if (incoming.minute) merged.minute = incoming.minute;
  if (hasScore(incoming)) merged.score = incoming.score;
  if (incoming.channel && !merged.channel) merged.channel = incoming.channel;
  if (incoming.commentator && !merged.commentator) merged.commentator = incoming.commentator;
  if (incoming.venue && !merged.venue) merged.venue = incoming.venue;
  if (incoming.leagueSlug && !merged.leagueSlug) merged.leagueSlug = incoming.leagueSlug;
  if (incoming.competition && !merged.competition) merged.competition = incoming.competition;
  if (incoming.leagueAr && !merged.leagueAr) merged.leagueAr = incoming.leagueAr;
  merged.source = existing.source === incoming.source ? existing.source : `${existing.source}+${incoming.source}`;
  return merged;
}

function mergeMatches(primary, fallback) {
  const byKey = new Map();
  const merged = [];
  for (const m of primary.concat(fallback)) {
    const key = matchKey(m);
    if (!key.replace(/\|/g, "")) {
      merged.push(m);
      continue;
    }
    const index = byKey.get(key);
    if (index == null) {
      byKey.set(key, merged.length);
      merged.push(m);
    } else {
      merged[index] = mergeMatch(merged[index], m);
    }
  }
  return merged;
}

function filterDisplayMatches(matches, now = Date.now()) {
  const normalized = matches.map((m) => {
    const status = demoteStaleLive(m.status, m.kickoffUtc, now);
    if (status === m.status) return m;
    return { ...m, status, minute: status === "live" ? m.minute : "" };
  });
  return normalized.filter((m) => {
    if (m.status !== "ended") return true;
    const kickoff = parseKickoffMs(m.kickoffUtc);
    if (isNaN(kickoff)) return true;
    return now - kickoff <= MATCH_WINDOW_MS + RECENT_ENDED_MS;
  });
}

function sortMatches(matches) {
  const order = { live: 0, upcoming: 1, ended: 2 };
  return matches.sort((a, b) => {
    const byStatus = order[a.status] - order[b.status];
    if (byStatus) return byStatus;
    const at = parseKickoffMs(a.kickoffUtc);
    const bt = parseKickoffMs(b.kickoffUtc);
    if (!isNaN(at) && !isNaN(bt)) {
      return a.status === "ended" ? bt - at : at - bt;
    }
    return a.time.localeCompare(b.time);
  });
}

module.exports = {
  COMPETITIONS,
  ESPN_LEAGUES,
  arabiaDayIso,
  arabiaTodayIso,
  ARABIA_TZ_OFFSET_HOURS,
  competitionForEspnSlug,
  competitionForLeagueName,
  filterDisplayMatches,
  isSupportedLeagueName,
  mergeMatches,
  normalizeEspnEvent,
  normalizeEvent,
  parseKickoffMs,
  sortMatches,
  statusOf,
};
