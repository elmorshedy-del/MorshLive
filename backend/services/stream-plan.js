import bundledCatalog from "../../assets/data/stream-plans.json" with { type: "json" };
import {
  applyConflicts,
  emptyCatalog,
  liveContentConflicts,
  preferNewerCatalog,
  resolveStreamPlan,
} from "../../lib/stream-plan.js";
import { fetchAssetJson, loadTodayMatches } from "../adapters/assets.js";

export async function loadStreamPlanCatalog(env, origin) {
  const json = await fetchAssetJson(env, origin, "/assets/data/stream-plans.json");
  const asset = json && Array.isArray(json.plans) ? { ...emptyCatalog(), ...json, plans: json.plans } : null;
  const bundled =
    Array.isArray(bundledCatalog?.plans) && bundledCatalog.plans.length
      ? { ...emptyCatalog(), ...bundledCatalog, plans: bundledCatalog.plans }
      : null;
  return preferNewerCatalog(asset, bundled);
}

function findRequestedMatch(matches, params) {
  const matchId = String(params.get("match") || "").trim();
  const home = String(params.get("home") || "").trim();
  const away = String(params.get("away") || "").trim();
  if (matchId) {
    const exact = matches.find((match) => match.id === matchId);
    if (exact) return exact;
    return {
      id: matchId,
      home,
      away,
      channelId: String(params.get("channel") || "").trim(),
      embedKey: String(params.get("embed") || "").trim(),
      status: "upcoming",
    };
  }
  if (home && away) {
    return (
      matches.find(
        (match) =>
          String(match.home || "").toLowerCase() === home.toLowerCase() &&
          String(match.away || "").toLowerCase() === away.toLowerCase(),
      ) || {
        id: `pair-${home}-${away}`,
        home,
        away,
        channelId: String(params.get("channel") || "").trim(),
        status: "upcoming",
      }
    );
  }
  return null;
}

export async function getStreamPlan(env, origin, params) {
  const matchId = String(params.get("match") || "").trim();
  const home = String(params.get("home") || "").trim();
  const away = String(params.get("away") || "").trim();
  if (!matchId && !(home && away)) throw new Error("Match id or team pair required");

  const [catalog, matches] = await Promise.all([
    loadStreamPlanCatalog(env, origin),
    loadTodayMatches(env, origin),
  ]);
  const match = findRequestedMatch(matches, params);
  if (!match) throw new Error("Unknown match");

  const live = matches.filter((row) => row.status === "live");
  const conflicts = liveContentConflicts(live, catalog);
  return applyConflicts(
    resolveStreamPlan({
      match,
      catalog,
      legacyEmbedKey: params.get("embed") || match.embedKey || "",
    }),
    conflicts,
  );
}
