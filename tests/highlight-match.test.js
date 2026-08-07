import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  titleTeams,
  resolveFixtureKey,
  isNonFootballTitle,
} = require("../scripts/lib/highlight-match-lib.js");

describe("titleTeams", () => {
  it("parses vortex-style titles with inline scores", () => {
    expect(titleTeams("ملخص مباراة مصر وايران 1 1 كأس العالم")).toEqual({
      a: "مصر",
      b: "ايران",
    });
  });

  it("parses parenthetical scores before نهائي", () => {
    expect(titleTeams("ملخص مباراة اسبانيا والارجنتين (1-0) نهائي كأس العالم 2026")).toEqual({
      a: "اسبانيا",
      b: "الارجنتين",
    });
  });
});

describe("isNonFootballTitle", () => {
  it("flags handball/basketball/volleyball reels", () => {
    expect(isNonFootballTitle("اهداف مباراة مصر واسبانيا 29 31 كأس العالم لكرة اليد تحت 19 عام")).toBe(true);
    expect(isNonFootballTitle("ملخص مباراة مصر والسعودية في كرة السلة")).toBe(true);
  });

  it("does not flag ordinary football titles", () => {
    expect(isNonFootballTitle("ملخص مباراة مصر وايران 1 1 كأس العالم")).toBe(false);
  });
});

describe("resolveFixtureKey", () => {
  const matches = [
    { home: "Australia", away: "Egypt" },
    { home: "Belgium", away: "Egypt" },
  ];
  const pairKeyFn = (a, b) => [a, b].sort().join("~");
  const arabicTeam = (name) => ({ Australia: "أستراليا", Egypt: "مصر", Belgium: "بلجيكا" })[name] || name;

  it("never attaches an other-sport clip even when a team name matches strongly", () => {
    // Regression: a U-19 handball reel mentioning Egypt previously out-scored
    // every real fixture and got attached to the Australia vs Egypt football match.
    const key = resolveFixtureKey(
      "اهداف مباراة مصر واسبانيا 29 31 كأس العالم لكرة اليد تحت 19 عام",
      null,
      matches,
      { pairKeyFn, arabicTeam, minMentionScore: 0.5 },
    );
    expect(key).toBeNull();
  });

  it("still resolves genuine football titles by mention score", () => {
    const key = resolveFixtureKey("ملخص فوز مصر على بلجيكا كأس العالم", null, matches, {
      pairKeyFn,
      arabicTeam,
      minMentionScore: 0.85,
    });
    expect(key).toBe(pairKeyFn("Belgium", "Egypt"));
  });
});
