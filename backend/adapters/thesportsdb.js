const SPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json/3";

function compactToIso(day) {
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}

export async function fetchSportsDbDay(day, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({ d: compactToIso(day), s: "Soccer" });
  const res = await fetchImpl(`${SPORTSDB_BASE}/eventsday.php?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`TheSportsDB upstream ${res.status}`);
  const body = await res.json();
  return Array.isArray(body.events) ? body.events : [];
}
