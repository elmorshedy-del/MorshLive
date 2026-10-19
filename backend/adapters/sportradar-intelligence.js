import { normalizeMomentum, normalizeTimeline } from "../../lib/match-intel.js";

const PREFIX = "https://api.sportradar.com/";
const EVENT_ID = /^sr:sport_event:\d{1,15}$/;

/**
 * This is OFF unless BOTH the server-side secret and an explicitly licensed
 * public-display flag are configured. Never put the credential in site JS.
 */
export async function getSportradarIntel(env, eventId, fetchImpl = fetch) {
  if (env?.SPORTRADAR_PUBLIC_DISPLAY_ENABLED !== "true") {
    return { available: false, reason: "not_enabled" };
  }
  if (!env.SPORTRADAR_API_KEY) return { available: false, reason: "not_configured" };
  if (!EVENT_ID.test(eventId || "")) return { available: false, reason: "invalid_id" };

  const tier = env.SPORTRADAR_ACCESS_LEVEL === "production" ? "production" : "trial";
  const headers = { "x-api-key": env.SPORTRADAR_API_KEY, accept: "application/json" };
  const path = encodeURIComponent(eventId);
  const feeds = [
    { key: "momentum", url: `${PREFIX}soccer-extended/${tier}/v4/en/sport_events/${path}/momentum.json` },
    { key: "timeline", url: `${PREFIX}soccer/${tier}/v4/en/sport_events/${path}/timeline.json` },
  ];
  // Requests are sequential to respect trial 1 QPS. A per-visitor live feed
  // requires a centralized ingest/cache when cleared for public distribution.
  const result = {};
  for (const feed of feeds) {
    try {
      const response = await fetchImpl(feed.url, { headers, signal: AbortSignal.timeout(6000) });
      if (response.ok) result[feed.key] = await response.json();
      else result[feed.key + "Status"] = response.status;
    } catch {
      result[feed.key + "Status"] = 0;
    }
    if (feed.key === "momentum") await new Promise((r) => setTimeout(r, 1100));
  }

  return {
    available: Boolean(result.momentum || result.timeline),
    source: "sportradar",
    generatedAt: result.momentum?.generated_at || result.timeline?.generated_at || null,
    momentum: normalizeMomentum(result.momentum),
    events: normalizeTimeline(result.timeline),
    coverage: {
      momentum: Boolean(result.momentum),
      timeline: Boolean(result.timeline),
    },
  };
}
