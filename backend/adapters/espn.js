const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

async function fetchEspnJson(path) {
  const res = await fetch(`${ESPN_BASE}/${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "KoraZero/1.0 football-match-centre",
    },
  });
  if (!res.ok) throw new Error(`ESPN upstream ${res.status}`);
  return res.json();
}

export function fetchEspnScoreboard(slug, dates) {
  const params = new URLSearchParams({ dates, limit: "100" });
  return fetchEspnJson(`${slug}/scoreboard?${params.toString()}`);
}

export function fetchEspnSummary(slug, eventId) {
  const params = new URLSearchParams({ event: eventId });
  return fetchEspnJson(`${slug}/summary?${params.toString()}`);
}
