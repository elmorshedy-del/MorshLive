import bundledCatalog from "../../assets/data/stream-plans.json" with { type: "json" };
import {
  applyConflicts,
  emptyCatalog,
  liveContentConflicts,
  preferNewerCatalog,
  resolveStreamPlan,
} from "../../lib/stream-plan.js";
import { fetchAssetJson, loadTodayMatches } from "../adapters/assets.js";

const V2_ACTIVE_URL = "https://v2-control-production.up.railway.app/api/active";
const V2_MIST_SOURCE_RE = /^https:\/\/v2-mist-production\.up\.railway\.app\/hls\/(iptv-\d+)\/index\.m3u8(?:[?#].*)?$/i;

function v2ChannelId(source) {
  const match = String(source?.playbackUrl || source?.url || "").match(V2_MIST_SOURCE_RE);
  return match ? match[1].toLowerCase() : null;
}

function v2Sources(plan) {
  const sources = [];
  if (plan?.selected) sources.push(plan.selected);
  for (const source of plan?.alternates || []) {
    if (!sources.some((item) => item.id === source.id && item.url === source.url)) sources.push(source);
  }
  return sources.filter((source) => v2ChannelId(source));
}

async function loadActiveV2State(env) {
  const endpoint = String(env?.V2_CONTROL_ACTIVE_URL || V2_ACTIVE_URL).trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    if (!body || body.conflict) return { activeChannelId: null, conflict: Boolean(body?.conflict) };
    const activeChannelId = String(body.active?.channelId || "").toLowerCase();
    return { activeChannelId: /^iptv-\d+$/.test(activeChannelId) ? activeChannelId : null, conflict: false };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function gateV2Plan(plan, state) {
  const sources = v2Sources(plan);
  if (!sources.length || plan?.status === "conflict") return plan;

  const activeChannelId = state?.activeChannelId || null;
  const activeSource = sources.find((source) => v2ChannelId(source) === activeChannelId) || null;

  if (activeSource) {
    const selected = {
      ...activeSource,
      role: "primary",
      status: "operator",
      effectiveStatus: "operator",
      playbackUrl: activeSource.playbackUrl || activeSource.url,
    };
    return {
      ...plan,
      status: "operator",
      selected,
      alternates: sources
        .filter((source) => source !== activeSource)
        .map((source) => ({ ...source, role: "alternate", status: "pending", effectiveStatus: "pending" })),
      profile: plan.selected?.id === activeSource.id ? plan.profile : null,
      reason: `remote-active:${activeChannelId}`,
      v2Remote: { active: activeChannelId },
    };
  }

  return {
    ...plan,
    status: "waiting",
    selected: null,
    alternates: sources.map((source) => ({
      ...source,
      role: "alternate",
      status: "pending",
      effectiveStatus: "pending",
      playbackUrl: undefined,
    })),
    profile: null,
    reason: state === null ? "v2-remote-unavailable" : activeChannelId ? `v2-remote-other:${activeChannelId}` : "v2-remote-off",
    v2Remote: { active: activeChannelId },
  };
}

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
  const resolved = applyConflicts(
    resolveStreamPlan({
      match,
      catalog,
      legacyEmbedKey: params.get("embed") || match.embedKey || "",
    }),
    conflicts,
  );

  if (!v2Sources(resolved).length) return resolved;
  const activeState = await loadActiveV2State(env);
  return gateV2Plan(resolved, activeState);
}
