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
  it("covers the club competitions plus the selected international-break feeds", () => {
    expect(ESPN_LEAGUES).toEqual([
      "eng.1",
      "esp.1",
      "fra.1",
      "ksa.1",
      "uefa.champions",
      "uefa.champions_qual",
      "caf.nations_qual",
      "uefa.nations",
      "fifa.friendly",
      "fifa.worldq.conmebol",
      "global.gulf_cup",
    ]);
    expect(competitionForLeagueName("English Premier League")?.key).toBe("epl");
    expect(competitionForLeagueName("Spanish LALIGA")?.key).toBe("laliga");
    expect(competitionForLeagueName("French Ligue 1")?.key).toBe("ligue1");
    expect(competitionForLeagueName("Saudi Pro League")?.key).toBe("spl");
    expect(competitionForLeagueName("Saudi-Arabian Pro League")?.key).toBe("spl");
    expect(competitionForLeagueName("UEFA Champions League Qualifying")?.key).toBe("ucl");
    expect(competitionForLeagueName("African Cup of Nations Qualifying")?.key).toBe("afconq");
    expect(competitionForLeagueName("Africa Cup of Nations Qualifying")?.key).toBe("afconq");
    expect(competitionForLeagueName("UEFA Nations League")?.key).toBe("unl");
    expect(competitionForLeagueName("International Friendly")?.key).toBe("friendly");
    expect(competitionForLeagueName("FIFA World Cup Qualifying - CONMEBOL")?.key).toBe("conmebolq");
    expect(competitionForLeagueName("Arabian Gulf Cup")?.key).toBe("gulfcup");
    expect(competitionForLeagueName("Gulf Cup of Nations")?.key).toBe("gulfcup");
    expect(competitionForLeagueName("CONCACAF Nations League")).toBeNull();
  });

  it("normalizes CONMEBOL World Cup qualifying fixtures through the shared competition metadata", () => {
    const match = normalizeEspnEvent(
      {
        id: "403000001",
        date: "2025-09-09T23:30:00Z",
        competitions: [
          {
            date: "2025-09-09T23:30:00Z",
            status: { type: { state: "pre" } },
            competitors: [
              { homeAway: "home", team: { displayName: "Brazil", abbreviation: "BRA" } },
              { homeAway: "away", team: { displayName: "Bolivia", abbreviation: "BOL" } },
            ],
          },
        ],
      },
      { slug: "fifa.worldq.conmebol", name: "FIFA World Cup Qualifying - CONMEBOL" },
    );

    expect(match).toMatchObject({
      id: "espn-fifa.worldq.conmebol-403000001",
      competition: "conmebolq",
      league: "FIFA World Cup Qualifying - CONMEBOL",
      leagueAr: "تصفيات كأس العالم - أمريكا الجنوبية",
      leagueSlug: "fifa.worldq.conmebol",
      home: "Brazil",
      away: "Bolivia",
    });
  });

  it("normalizes Arabian Gulf Cup fixtures through the shared competition metadata",
    const match = normalizeEspnEvent(
      {
        id: "402999999",
        date: "2026-09-23T18:00:00Z",
        competitions: [
          {
            date: "2026-09-23T18:00:00Z",
            status: { type: { state: "pre" } },
            competitors: [
              { homeAway: "home", team: { displayName: "Saudi Arabia", abbreviation: "KSA" } },
              { homeAway: "away", team: { displayName: "Kuwait", abbreviation: "KUW" } },
            ],
          },
        ],
      },
      { slug: "global.gulf_cup", name: "Arabian Gulf Cup" },
    );

    expect(match).toMatchObject({
      id: "espn-global.gulf_cup-402999999",
      competition: "gulfcup",
      league: "Arabian Gulf Cup",
      leagueAr: "كأس الخليج العربي",
      leagueSlug: "global.gulf_cup",
      home: "Saudi Arabia",
      away: "Kuwait",
    });
  });

  it("keeps the ESPN event identity required for lineups and stats", () => {
    const espn = normalizeEspnEvent(
      {
        id: "401999999",
        date: "2026-08-22T17:00:00Z",
        competitions: [
          {
            date: "2026-08-22T17:00:00Z",
            status: { type: { state: "pre" } },
            competitors: [
              { homeAway: "home", team: { displayName: "Arsenal" } },
              { homeAway: "away", team: { displayName: "Liverpool" } },
            ],
          },
        ],
      },
      { slug: "eng.1", name: "English Premier League" },
    );
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
