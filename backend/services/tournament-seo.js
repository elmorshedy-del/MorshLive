import { injectTournamentArchiveLinks } from "../../lib/tournament-seo.js";
import { fetchAssetText, loadWorldCupMatchIndex } from "../adapters/assets.js";

export async function renderTournamentSeoDocument(env, origin) {
  const [html, index] = await Promise.all([
    fetchAssetText(env, origin, "/tournament.html"),
    loadWorldCupMatchIndex(env, origin),
  ]);
  if (!html) return "";
  return injectTournamentArchiveLinks(html, index);
}
