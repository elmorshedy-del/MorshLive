/**
 * Read generated JSON/static files from the ASSETS binding.
 * All asset reads go through adapters — routes/services never call env.ASSETS directly.
 */

export async function fetchAssetJson(env, origin, path) {
  const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await env.ASSETS.fetch(url);
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchAssetText(env, origin, path) {
  const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await env.ASSETS.fetch(url);
  return res.ok ? res.text() : "";
}

export function fetchStaticAsset(env, request) {
  return env.ASSETS.fetch(request);
}

export async function loadTodayMatches(env, origin) {
  const json = await fetchAssetJson(env, origin, "/assets/data/today.json");
  return Array.isArray(json?.matches) ? json.matches : [];
}

export async function loadTeamNamesAr(env, origin) {
  return (await fetchAssetJson(env, origin, "/assets/data/team-names-ar.json")) || {};
}

export async function loadSeasonHighlights(env, origin) {
  return (await fetchAssetJson(env, origin, "/assets/data/season-highlights.json")) || { days: [] };
}

export async function loadWorldCupMatchIndex(env, origin) {
  return (await fetchAssetJson(env, origin, "/assets/data/wc-matches-index.json")) || { matches: [] };
}

export async function loadMemeSources(env, origin) {
  return fetchAssetJson(env, origin, "/assets/data/meme-sources.json");
}
