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
      "eng.league_cup",
      "esp.1",
      "fra.1",
      "ksa.1",
      "uefa.champions",
      "uefa.champions_qual",
      "caf.nations_qual",
      "uefa.nations",
      "uefa.euro",
      "uefa.euroq",
      "fifa.worldq.uefa",
      "fifa.friendly",
      "fifa.worldq.conmebol",
    ]);
    expect(competitionForLeagueName("English Premier League")?.key).toBe("epl");
    expect(competitionForLeagueName("English Carabao Cup")?.key).toBe("eflcup");
    expect(competitionForLeagueName("Spanish LALIGA")?.key).toBe("laliga");
    expect(competitionForLeagueName("French Ligue 1")?.key).toBe("ligue1");
    expect(competitionForLeagueName("Saudi Pro League")?.key).toBe("spl");
    expect(competitionForLeagueName("Saudi-Arabian Pro League")?.key).toBe("spl");
    expect(competitionForLeagueName("UEFA Champions League Qualifying")?.key).toBe("ucl");
    expect(competitionForLeagueName("African Cup of Nations Qualifying")?.key).toBe("afconq");
    expect(competitionForLeagueName("Africa Cup of Nations Qualifying")?.key).toBe("afconq");
    expect(competitionForLeagueName("UEFA Nations League")?.key).toBe("unl");
    expect(competitionForLeagueName("UEFA European Championship")?.key).toBe("euro");
    expect(competitionForLeagueName("UEFA European Championship Qualifying")?.key).toBe("euroq");
    expect(competitionForLeagueName("FIFA World Cup Qualifying - UEFA")?.key).toBe("uefawcq");
    expect(competitionForLeagueName("International Friendly")?.key).toBe("friendly");
    expect(competitionForLeagueName("FIFA World Cup Qualifying - CONMEBOL")?.key).toBe("conmebolq");
    expect(competitionForLeagueName("CONCACAF Nations League")).toBeNull();
  });

  it("normalizes every European national-team competition through shared metadata", () => {
    const cases = [
      ["uefa.nations", "UEFA Nations League", "unl", "دوري الأمم الأوروبية"],
      ["uefa.euro", "UEFA European Championship", "euro", "بطولة أمم أوروبا"],
      ["uefa.euroq", "UEFA European Championship Qualifying", "euroq", "تصفيات بطولة أمم أوروبا"],
      ["fifa.worldq.uefa", "FIFA World Cup Qualifying - UEFA", "uefawcq", "تصفيات كأس العالم - أوروبا"],
    ];

    for (const [slug, name, key, nameAr] of cases) {
      const match = normalizeEspnEvent(
        {
          id: "403100001",
          date: "2026-09-26T18:45:00Z",
          competitions: [
            {
              date: "2026-09-26T18:45:00Z",
              status: { type: { state: "pre" } },
              competitors: [
                { homeAway: "home", team: { displayName: "England", abbreviation: "ENG" } },
                { homeAway: "away", team: { displayName: "Spain", abbreviation: "ESP" } },
              ],
            },
          ],
        },
        { slug, name },
      );

      expect(match).toMatchObject({
        id: `espn-${slug}-403100001`,
        competition: key,
        league: name,
        leagueAr: nameAr,
        leagueSlug: slug,
        home: "England",
        away: "Spain",
      });
    }
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


  it("normalizes October 28 Carabao Cup fixtures with ESPN identity and Arabic competition name", () => {
    for (const [eventId, homeName, awayName, kickoffUtc] of [
      ["401921834", "Manchester City", "Brighton & Hove Albion", "2026-10-28T19:30Z"],
      ["401921842", "Liverpool", "Chelsea", "2026-10-28T20:00Z"],
    ]) {
      const match = normalizeEspnEvent(
        {
          id: eventId,
          date: kickoffUtc,
          competitions: [{
            date: kickoffUtc,
            status: { type: { state: "pre" } },
            competitors: [
              { homeAway: "home", team: { displayName: homeName } },
              { homeAway: "away", team: { displayName: awayName } },
            ],
          }],
        },
        { slug: "eng.league_cup", name: "English Carabao Cup" },
      );
      expect(match).toMatchObject({
        id: `espn-eng.league_cup-${eventId}`,
        competition: "eflcup",
        league: "English Carabao Cup",
        leagueAr: "كأس الرابطة الإنجليزية",
        leagueSlug: "eng.league_cup",
        home: homeName,
        away: awayName,
        kickoffUtc,
      });
    }
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
