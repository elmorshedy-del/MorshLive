import { describe, expect, it } from "vitest";
import {
  findArchiveMatchByQuery,
  matchesForTeam,
  slugFromTeamName,
  teamFromSlug,
  teamNamesFromMatches,
  teamPageTitleAr,
} from "../lib/wc-team-slug.js";

describe("wc-team-slug", () => {
  const matches = [
    { id: "espn-fifa.world-760504", key: "brazil~norway", home: "Brazil", away: "Norway" },
    { id: "espn-fifa.world-760001", key: "morocco~argentina", home: "Morocco", away: "Argentina" },
  ];

  it("slugifies team names for pretty URLs", () => {
    expect(slugFromTeamName("Morocco")).toBe("morocco");
    expect(slugFromTeamName("United States")).toBe("united-states");
    expect(slugFromTeamName("Bosnia-Herzegovina")).toBe("bosnia-herzegovina");
    expect(slugFromTeamName("Türkiye")).toBe("turkiye");
  });

  it("resolves slug back to canonical English team name", () => {
    const teams = teamNamesFromMatches(matches);
    expect(teamFromSlug("morocco", teams)).toBe("Morocco");
    expect(teamFromSlug("unknown", teams)).toBeNull();
  });

  it("filters matches for a team", () => {
    expect(matchesForTeam(matches, "Morocco").map((m) => m.key)).toEqual(["morocco~argentina"]);
  });

  it("finds archive matches by key or espn id", () => {
    expect(findArchiveMatchByQuery(matches, "brazil~norway").id).toBe("espn-fifa.world-760504");
    expect(findArchiveMatchByQuery(matches, "espn-fifa.world-760504").key).toBe("brazil~norway");
    expect(findArchiveMatchByQuery(matches, "missing")).toBeNull();
  });

  it("builds Arabic SEO title", () => {
    expect(teamPageTitleAr("المغرب")).toBe("ملخصات مباريات المغرب في كأس العالم 2026");
  });
});
