import { fetchEspnScoreboard, fetchEspnSummary } from "../adapters/espn.js";

export const FOOTBALL_LEAGUES = Object.freeze([
  "eng.1",
  "esp.1",
  "ksa.1",
  "uefa.champions",
  "uefa.champions_qual",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

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
        .map((entry) => String(entry || "").slice(0, 10).replace(/-/g, ""))
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
    const settled = await Promise.allSettled(
      days.slice(1).map((day) => fetchEspnScoreboard(slug, day)),
    );
    const rows = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    if (!rows.length) throw new Error("ESPN daily scoreboard unavailable");
    return mergeScoreboardData(rows);
  }

  const scheduledDays = calendarDaysInRange(first, days).filter((day) => day !== firstDay);
  const settled = await Promise.allSettled(
    scheduledDays.map((day) => fetchEspnScoreboard(slug, day)),
  );
  const rows = [
    first,
    ...settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
  ];
  return mergeScoreboardData(rows);
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

  const leagues = recovered.filter(Boolean);
  if (!leagues.length) throw new Error("Football scoreboards unavailable");

  return {
    source: "espn",
    unofficial: true,
    dates: requested,
    leagues,
    unavailable: FOOTBALL_LEAGUES.filter((_, index) => !recovered[index]),
  };
}

export async function getFootballSummary(params) {
  const league = requireLeague(params.get("league") || "");
  const event = params.get("event") || "";
  if (!/^\d+$/.test(event)) throw new Error("Invalid ESPN event id");
  return fetchEspnSummary(league, event);
}
