import { fetchEspnScoreboard, fetchEspnSummary } from "../adapters/espn.js";

export const FOOTBALL_LEAGUES = Object.freeze([
  "eng.1",
  "esp.1",
  "ksa.1",
  "uefa.champions",
  "uefa.champions_qual",
]);

function defaultDateRange(now = Date.now()) {
  const day = (offset) => {
    const date = new Date(now + offset * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10).replace(/-/g, "");
  };
  return `${day(-1)}-${day(7)}`;
}

function validDateRange(value) {
  const match = /^(\d{8})-(\d{8})$/.exec(value || "");
  if (!match) return false;
  const parse = (raw) => Date.parse(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00Z`);
  const start = parse(match[1]);
  const end = parse(match[2]);
  return (
    Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 10 * 24 * 60 * 60 * 1000
  );
}

function requireLeague(slug) {
  if (!FOOTBALL_LEAGUES.includes(slug)) throw new Error("Unsupported football competition");
  return slug;
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
  const leagues = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  if (!leagues.length) throw new Error("Football scoreboards unavailable");

  return {
    source: "espn",
    unofficial: true,
    dates: requested,
    leagues,
    unavailable: FOOTBALL_LEAGUES.filter((_, index) => settled[index].status === "rejected"),
  };
}

export async function getFootballSummary(params) {
  const league = requireLeague(params.get("league") || "");
  const event = params.get("event") || "";
  if (!/^\d+$/.test(event)) throw new Error("Invalid ESPN event id");
  return fetchEspnSummary(league, event);
}
