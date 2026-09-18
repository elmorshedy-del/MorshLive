import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { FOOTBALL_LEAGUES } from "../backend/services/football.js";

const require = createRequire(import.meta.url);
const {
  ESPN_LEAGUES,
  competitionForLeagueName,
  filterDisplayMatches,
  normalizeEspnEvent,
  normalizeEvent,
} = require("../scripts/matches-lib.js");
const { TeamNames } = require("../assets/js/team-names.js");

function espnMatch({ id, home, away, kickoff = "2026-09-20T18:45:00Z" }) {
  return normalizeEspnEvent(
    {
      id,
      date: kickoff,
      competitions: [
        {
          date: kickoff,
          status: { type: { state: "pre" } },
          competitors: [
            { homeAway: "home", team: { displayName: home } },
            { homeAway: "away", team: { displayName: away } },
          ],
        },
      ],
    },
    { slug: "fra.1", name: "French Ligue 1" },
  );
}

describe("PSG-only Ligue 1 coverage", () => {
  it("fetches Ligue 1 through both server and Node fixture pipelines", () => {
    expect(FOOTBALL_LEAGUES).toContain("fra.1");
    expect(ESPN_LEAGUES).toContain("fra.1");
    expect(competitionForLeagueName("French Ligue 1")).toMatchObject({
      key: "ligue1",
      nameAr: "الدوري الفرنسي",
    });
  });

  it("keeps PSG Ligue 1 fixtures but drops every other Ligue 1 fixture", () => {
    const psg = espnMatch({
      id: "401876449",
      home: "Marseille",
      away: "Paris Saint-Germain",
    });
    const other = espnMatch({
      id: "401876468",
      home: "Toulouse",
      away: "Lille",
    });

    const visible = filterDisplayMatches([psg, other], Date.parse("2026-09-18T12:00:00Z"));

    expect(visible.map((match) => match.id)).toEqual(["espn-fra.1-401876449"]);
    expect(visible[0]).toMatchObject({
      competition: "ligue1",
      leagueAr: "الدوري الفرنسي",
      channelId: null,
    });
  });

  it("does not invent a channel when TheSportsDB is the PSG fallback", () => {
    const fallback = normalizeEvent({
      idEvent: "999",
      strLeague: "French Ligue 1",
      strHomeTeam: "Paris Saint-Germain",
      strAwayTeam: "Marseille",
      strTimestamp: "2026-09-20T18:45:00",
      strStatus: "NS",
    });
    expect(fallback).toMatchObject({
      competition: "ligue1",
      leagueAr: "الدوري الفرنسي",
      channelId: null,
    });
  });

  it("keeps PSG and every current Ligue 1 opponent Arabic-localized", () => {
    const clubs = [
      "Paris Saint-Germain", "Angers", "AJ Auxerre", "Brest", "Le Havre",
      "Lens", "Lille", "Lorient", "Lyon", "Le Mans", "Marseille", "Monaco",
      "Nice", "Paris FC", "Rennes", "Strasbourg", "Toulouse", "Troyes",
    ];
    for (const club of clubs) {
      expect(TeamNames.arabicFor(club), club).toBeTruthy();
      expect(TeamNames.arabicFor(club), club).not.toBe(club);
    }
    expect(TeamNames.arabicFor("Paris Saint-Germain")).toBe("باريس سان جيرمان");
    expect(TeamNames.arabicFor("Marseille")).toBe("مارسيليا");
  });
});
