import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  ESPN_LEAGUES,
  competitionForLeagueName,
  mergeMatches,
  normalizeEspnEvent,
} = require("../scripts/matches-lib.js");

describe("major competition configuration", () => {
  it("covers Premier League, La Liga, and both Champions League phases", () => {
    expect(ESPN_LEAGUES).toEqual([
      "eng.1",
      "esp.1",
      "uefa.champions",
      "uefa.champions_qual",
    ]);
    expect(competitionForLeagueName("English Premier League")?.key).toBe("epl");
    expect(competitionForLeagueName("Spanish LALIGA")?.key).toBe("laliga");
    expect(competitionForLeagueName("UEFA Champions League Qualifying")?.key).toBe("ucl");
  });

  it("keeps the ESPN event identity required for lineups and stats", () => {
    const espn = normalizeEspnEvent({
      id: "401999999",
      date: "2026-08-22T17:00:00Z",
      competitions: [{
        date: "2026-08-22T17:00:00Z",
        status: { type: { state: "pre" } },
        competitors: [
          { homeAway: "home", team: { displayName: "Arsenal" } },
          { homeAway: "away", team: { displayName: "Liverpool" } },
        ],
      }],
    }, { slug: "eng.1", name: "English Premier League" });
    const sportsDb = {
      ...espn,
      id: "e123",
      source: "thesportsdb",
      leagueSlug: null,
      competition: "",
    };

    const [merged] = mergeMatches([sportsDb], [espn]);
    expect(merged.id).toBe("espn-eng.1-401999999");
    expect(merged.competition).toBe("epl");
    expect(merged.leagueAr).toBe("الدوري الإنجليزي الممتاز");
  });
});
