import { jsonResponse } from "../http/response.js";
import { getSportradarIntel } from "../adapters/sportradar-intelligence.js";

export const matchIntelligenceRoute = {
  name: "match-intelligence",
  methods: ["GET"],
  test: (url) => url.pathname === "/api/match-intelligence",
  async handle({ env, url }) {
    const id = url.searchParams.get("srid") || "";
    // No secret + no public licence => no upstream requests or data exposure.
    // Even when enabled, upstream rate limits require a centralized polling
    // service before significant site traffic; this endpoint is experimental.
    if (env?.SPORTRADAR_PUBLIC_DISPLAY_ENABLED !== "true") {
      return jsonResponse({ available: false, reason: "not_enabled" }, { cacheSeconds: 300 });
    }
    const data = await getSportradarIntel(env, id);
    return jsonResponse(data, { cacheSeconds: 90, proxyTag: "match-intelligence" });
  },
};
