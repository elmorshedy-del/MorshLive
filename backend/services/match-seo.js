import { loadSeasonHighlights, loadTeamNamesAr, loadTodayMatches } from "../adapters/assets.js";
import { fetchEspnEventsForMatchDay, fetchEspnMatchSummary } from "../adapters/espn-seo.js";
import {
  enrichSeoMatchFromSummary,
  mergeKnownMatchData,
  normalizeSeoScoreboardEvent,
} from "../../lib/match-seo-data.js";
import { buildMatchSeoHtml } from "../../lib/match-seo-page.js";
import { matchPagePath } from "../../lib/seo-pages-core.js";

export function parseMatchSeoPath(pathname) {
  const match = /^\/(en\/)?match\/(\d{4}-\d{2}-\d{2})\/([a-z0-9-]+)\/?$/.exec(String(pathname || ""));
  if (!match) return null;
  return {
    lang: match[1] ? "en" : "ar",
    day: match[2],
    arRoute: `/match/${match[2]}/${match[3]}`,
  };
}

function seasonHighlightFor(match, seasonHighlights) {
  for (const day of seasonHighlights?.days || []) {
    const hit = (day.matches || []).find((row) => row.id && row.id === match.id);
    if (!hit?.embed) continue;
    return {
      videoUrl: hit.embed,
      thumbnail: hit.poster || "",
      title: `ملخص ${match.home} ضد ${match.away}`,
      source: "season-highlights",
    };
  }
  return null;
}

function cacheSecondsFor(match) {
  if (match.status === "live") return 30;
  if (match.status === "ended") return 3600;
  const kickoff = Date.parse(match.kickoffUtc || "");
  if (Number.isNaN(kickoff)) return 300;
  const until = kickoff - Date.now();
  if (until <= 2 * 60 * 60 * 1000) return 60;
  if (until <= 24 * 60 * 60 * 1000) return 300;
  return 900;
}

export async function renderMatchSeoDocument(env, url) {
  const parsed = parseMatchSeoPath(url.pathname);
  if (!parsed) return null;

  const groups = await fetchEspnEventsForMatchDay(parsed.day);
  const candidates = groups.flatMap(({ leagueSlug, events }) =>
    events.map((event) => normalizeSeoScoreboardEvent(event, leagueSlug)).filter(Boolean),
  );
  let match = candidates.find((candidate) => matchPagePath(candidate) === parsed.arRoute);
  if (!match) return null;

  const [summary, knownMatches, teamNamesAr, seasonHighlights] = await Promise.all([
    fetchEspnMatchSummary(match.leagueSlug, match.espnEventId),
    loadTodayMatches(env, url.origin),
    loadTeamNamesAr(env, url.origin),
    loadSeasonHighlights(env, url.origin),
  ]);
  if (summary) match = enrichSeoMatchFromSummary(match, summary);

  const known = knownMatches.find((row) => row.id === match.id);
  match = mergeKnownMatchData(match, known);
  if (!match.highlight) {
    const highlight = seasonHighlightFor(match, seasonHighlights);
    if (highlight) match.highlight = highlight;
  }

  const route = parsed.lang === "en" ? `/en${parsed.arRoute}` : parsed.arRoute;
  return {
    html: buildMatchSeoHtml({ match, route, siteUrl: url.origin, teamNamesAr, lang: parsed.lang }),
    match,
    cacheSeconds: cacheSecondsFor(match),
  };
}
