import { SEO_COMPETITIONS } from "../../lib/match-seo-data.js";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

function shiftDay(day, amount) {
  const ms = Date.parse(`${day}T12:00:00Z`);
  if (Number.isNaN(ms)) return day;
  return new Date(ms + amount * 86_400_000).toISOString().slice(0, 10);
}

function compactDay(day) {
  return String(day || "").replace(/-/g, "");
}

async function fetchJson(url, timeoutMs = 6000) {
  const response = await fetch(url, {
    headers: { "User-Agent": "KoraZero match page" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`ESPN ${response.status}`);
  return response.json();
}

export async function fetchEspnEventsForMatchDay(day) {
  // Match URLs use the Makkah calendar day. Query one UTC day either side so
  // a late-night UTC kickoff that crosses midnight in Arabia is still found.
  const from = compactDay(shiftDay(day, -1));
  const to = compactDay(shiftDay(day, 1));
  const dateRange = `${from}-${to}`;
  const results = await Promise.allSettled(
    SEO_COMPETITIONS.map(async (meta) => {
      const url = `${ESPN_BASE}/${meta.leagueSlug}/scoreboard?dates=${dateRange}&limit=200`;
      const json = await fetchJson(url);
      return {
        leagueSlug: meta.leagueSlug,
        events: Array.isArray(json.events) ? json.events : [],
      };
    }),
  );
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export async function fetchEspnMatchSummary(leagueSlug, eventId) {
  if (!leagueSlug || !eventId) return null;
  try {
    return await fetchJson(`${ESPN_BASE}/${leagueSlug}/summary?event=${encodeURIComponent(eventId)}`, 7000);
  } catch {
    return null;
  }
}
