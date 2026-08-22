import { jsonResponse } from "../http/response.js";
import { getFootballScoreboards, getFootballSummary } from "../services/football.js";

export const footballRoute = {
  name: "football",
  methods: ["GET"],
  test: (url) => url.pathname === "/api/football/scoreboard" || url.pathname === "/api/football/summary",
  async handle({ url }) {
    if (url.pathname.endsWith("/summary")) {
      const summary = await getFootballSummary(url.searchParams);
      return jsonResponse(summary, { cacheSeconds: 20, proxyTag: "espn-summary" });
    }
    const scoreboards = await getFootballScoreboards(url.searchParams);
    return jsonResponse(scoreboards, { cacheSeconds: 30, proxyTag: "espn-scoreboards" });
  },
};
