import { fetchEspnScoreboard, fetchEspnSummary } from "../adapters/espn.js";
import { fetchSportsDbDay } from "../adapters/thesportsdb.js";

export const FOOTBALL_LEAGUES = Object.freeze([
  "eng.1",
  "esp.1",
  "ksa.1",
  "uefa.champions",
  "uefa.champions_qual",
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const SPORTSDB_LEAGUE_SLUGS = new Map([
  ["english premier league", "eng.1"],
  ["spanish la liga", "esp.1"],
  ["spanish laliga", "esp.1"],
  ["laliga", "esp.1"],
  ["saudi pro league", "ksa.1"],
  ["saudi-arabian pro league", "ksa.1"],
  ["saudi professional league", "ksa.1"],
  ["roshn saudi league", "ksa.1"],
  ["uefa champions league", "uefa.champions"],
  ["uefa champions league qualifying", "uefa.champions_qual"],
]);
const SPORTSDB_LEAGUE_NAMES = Object.freeze({
  "eng.1": "English Premier League",
  "esp.1": "Spanish La Liga",
  "ksa.1": "Saudi Pro League",
  "uefa.champions": "UEFA Champions League",
  "uefa.champions_qual": "UEFA Champions League Qualifying",
});
const ENDED_STATUSES = new Set(["FT", "AET", "PEN", "MATCH FINISHED", "AWD", "WO", "CANC", "ABD", "PST"]);
const LIVE_STATUSES = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "IN PLAY", "INT"]);

function defaultDateRange(now = Date.now()) {
  const day = (offset) => {
    const date = new Date(now + offset * DAY_MS);
    return date.toISOString().slice(0, 10).replace(/-/g, "");
  };
  return `${day(-1)}-${day(7)}`;
}

function parseCompactDate(raw) {
  return Date.parse(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00Z`);
}

function validDateRange(value) {
  const match = /^(\d{8})-(\d{8})$/.exec(value || "");
  if (!match) return false;
  const start = parseCompactDate(match[1]);
  const end = parseCompactDate(match[2]);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 10 * DAY_MS;
}

function requireLeague(slug) {
  if (!FOOTBALL_LEAGUES.includes(slug)) throw new Error("Unsupported football competition");
  return slug;
}

function dateRangeDays(range) {
  const [startRaw, endRaw] = range.split("-");
  const start = parseCompactDate(startRaw);
  const end = parseCompactDate(endRaw);
  const days = [];
  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    days.push(new Date(cursor).toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return days;
}

function calendarDaysInRange(data, requestedDays) {
  const calendar = data?.leagues?.[0]?.calendar;
  if (!Array.isArray(calendar)) return requestedDays;
  const allowed = new Set(requestedDays);
  return [
    ...new Set(
      calendar
        .map((entry) =>
          String(entry || "")
            .slice(0, 10)
            .replace(/-/g, ""),
        )
        .filter((day) => allowed.has(day)),
    ),
  ];
}

function mergeScoreboardData(rows) {
  const first = rows[0] || {};
  const events = new Map();
  for (const row of rows) {
    for (const event of Array.isArray(row?.events) ? row.events : []) {
      const key = String(event?.id || `${event?.date || ""}|${event?.name || ""}`);
      if (!events.has(key)) events.set(key, event);
    }
  }
  return { ...first, events: [...events.values()] };
}

async function fetchEspnScoreboardDaily(slug, range) {
  const days = dateRangeDays(range);
  const firstDay = days[0];
  let first;

  try {
    first = await fetchEspnScoreboard(slug, firstDay);
  } catch {
    const settled = await Promise.allSettled(days.slice(1).map((day) => fetchEspnScoreboard(slug, day)));
    const rows = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    if (!rows.length) throw new Error("ESPN daily scoreboard unavailable");
    return mergeScoreboardData(rows);
  }

  const scheduledDays = calendarDaysInRange(first, days).filter((day) => day !== firstDay);
  const settled = await Promise.allSettled(scheduledDays.map((day) => fetchEspnScoreboard(slug, day)));
  const rows = [first, ...settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))];
  return mergeScoreboardData(rows);
}

function sportsDbSlug(event) {
  return SPORTSDB_LEAGUE_SLUGS.get(String(event?.strLeague || "").trim().toLowerCase()) || null;
}

function sportsDbKickoff(event) {
  const value = String(event?.strTimestamp || "").trim();
  if (!value) return null;
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
}

function sportsDbStatus(event) {
  const raw = String(event?.strStatus || "").trim().toUpperCase();
  if (ENDED_STATUSES.has(raw) || raw.startsWith("FT")) {
    return { displayClock: event.strStatus || "FT", type: { state: "post", completed: true } };
  }
  if (LIVE_STATUSES.has(raw) || /^\d+$/.test(raw) || raw.includes("'")) {
    return { displayClock: event.strProgress || event.strStatus || "LIVE", type: { state: "in", completed: false } };
  }
  return { displayClock: event.strStatus || "", type: { state: "pre", completed: false } };
}

function sportsDbEventToEspnShape(event) {
  const kickoff = sportsDbKickoff(event);
  return {
    id: String(event.idEvent || ""),
    date: kickoff,
    name: event.strEvent || `${event.strHomeTeam || ""} vs ${event.strAwayTeam || ""}`,
    source: "thesportsdb",
    competitions: [
      {
        date: kickoff,
        altGameNote: event.strLeague || "",
        status: sportsDbStatus(event),
        competitors: [
          {
            homeAway: "home",
            score: event.intHomeScore,
            team: {
              displayName: event.strHomeTeam || "",
              name: event.strHomeTeam || "",
              logo: event.strHomeTeamBadge || "",
            },
          },
          {
            homeAway: "away",
            score: event.intAwayScore,
            team: {
              displayName: event.strAwayTeam || "",
              name: event.strAwayTeam || "",
              logo: event.strAwayTeamBadge || "",
            },
          },
        ],
        venue: {
          fullName: event.strVenue || "",
          address: { city: event.strCity || "", country: event.strCountry || "" },
        },
      },
    ],
  };
}

async function fetchSportsDbRows(range) {
  const settled = await Promise.allSettled(dateRangeDays(range).map((day) => fetchSportsDbDay(day)));
  const fulfilled = settled.filter((result) => result.status === "fulfilled");
  if (!fulfilled.length) throw new Error("TheSportsDB scoreboards unavailable");

  const eventsBySlug = new Map(FOOTBALL_LEAGUES.map((slug) => [slug, new Map()]));
  for (const result of fulfilled) {
    for (const event of result.value) {
      const slug = sportsDbSlug(event);
      if (!slug) continue;
      const id = String(event.idEvent || `${event.strTimestamp || ""}|${event.strEvent || ""}`);
      eventsBySlug.get(slug).set(id, sportsDbEventToEspnShape(event));
    }
  }

  return new Map(
    FOOTBALL_LEAGUES.map((slug) => [
      slug,
      {
        slug,
        data: {
          leagues: [{ name: SPORTSDB_LEAGUE_NAMES[slug], slug }],
          events: [...eventsBySlug.get(slug).values()],
        },
      },
    ]),
  );
}

export async function getFootballScoreboards(params) {
  const requested = params.get("dates") || defaultDateRange();
  if (!validDateRange(requested)) throw new Error("Invalid scoreboard date range");

  const settled = await Promise.allSettled(
    FOOTBALL_LEAGUES.map(async (slug) => ({
      slug,
      data: await fetchEspnScoreboard(slug, requested),
    })),
  );

  const recovered = await Promise.all(
    settled.map(async (result, index) => {
      if (result.status === "fulfilled") return result.value;
      const slug = FOOTBALL_LEAGUES[index];
      try {
        return { slug, data: await fetchEspnScoreboardDaily(slug, requested) };
      } catch {
        return null;
      }
    }),
  );

  let sportsDbRows = null;
  if (recovered.some((row) => !row)) {
    try {
      sportsDbRows = await fetchSportsDbRows(requested);
    } catch {
      sportsDbRows = null;
    }
  }

  const leagues = FOOTBALL_LEAGUES.map((slug, index) => recovered[index] || sportsDbRows?.get(slug) || null).filter(Boolean);
  if (!leagues.length) throw new Error("Football scoreboards unavailable");

  const usedSportsDb = leagues.some((row, index) => !recovered[index] && row === sportsDbRows?.get(FOOTBALL_LEAGUES[index]));
  const usedEspn = recovered.some(Boolean);

  return {
    source: usedSportsDb ? (usedEspn ? "espn+thesportsdb" : "thesportsdb") : "espn",
    unofficial: true,
    dates: requested,
    leagues,
    unavailable: FOOTBALL_LEAGUES.filter((slug, index) => !recovered[index] && !sportsDbRows?.get(slug)),
  };
}

export async function getFootballSummary(params) {
  const league = requireLeague(params.get("league") || "");
  const event = params.get("event") || "";
  if (!/^\d+$/.test(event)) throw new Error("Invalid ESPN event id");
  return fetchEspnSummary(league, event);
}
