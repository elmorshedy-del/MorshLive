/* Shared normalization for Node (fetch-matches.js) — keep in sync with matches-api.js */
const LIVE = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "IN PLAY", "INT"]);
const ENDED = new Set(["FT", "AET", "PEN", "Match Finished", "AWD", "WO", "CANC", "ABD", "PST"]);

function abbr(name) {
  return (name || "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function kickoffStatus(ts, fallback) {
  if (!ts) return fallback;
  const kickoff = Date.parse(ts);
  if (isNaN(kickoff)) return fallback;
  const elapsed = Date.now() - kickoff;
  const windowMs = 135 * 60 * 1000;
  if (elapsed < 0) return "upcoming";
  if (elapsed < windowMs) return "live";
  return "ended";
}

function statusOf(strStatus, strTimestamp) {
  const s = (strStatus || "").trim();
  if (!s || s === "NS" || /not started/i.test(s)) {
    return kickoffStatus(strTimestamp, "upcoming");
  }
  if (ENDED.has(s) || /^FT/i.test(s)) return "ended";
  if (LIVE.has(s) || /^\d+$/.test(s) || /'/.test(s) || /half/i.test(s)) return "live";
  return kickoffStatus(strTimestamp, "upcoming");
}

function formatScore(hs, as, status) {
  const has = hs != null && hs !== "" && as != null && as !== "";
  if (has) return `${hs} - ${as}`;
  return status === "ended" ? "0 - 0" : "VS";
}

function formatTime(e) {
  if (e.strTimeLocal) return e.strTimeLocal.slice(0, 5);
  if (e.strTime) return e.strTime.slice(0, 5);
  if (e.strTimestamp) return new Date(e.strTimestamp).toISOString().slice(11, 16);
  return "—";
}

function normalizeEvent(e) {
  const status = statusOf(e.strStatus, e.strTimestamp);
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
    venue: [e.strVenue, e.strCity].filter(Boolean).join(" · "),
    channel: null,
    channelId: "bein-sports-1",
    commentator: null,
    source: "thesportsdb",
  };
}

function sortMatches(matches) {
  const order = { live: 0, upcoming: 1, ended: 2 };
  return matches.sort(
    (a, b) => (order[a.status] - order[b.status]) || a.time.localeCompare(b.time)
  );
}

module.exports = { statusOf, normalizeEvent, sortMatches };
