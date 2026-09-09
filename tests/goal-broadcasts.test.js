import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  findGoalFixture,
  isNonSeniorTeam,
  pickArabicBeinChannel,
  sameTeam,
} = require("../scripts/goal-broadcasts-lib.js");

/**
 * goal.com is the source that gets European channel numbers right, where the
 * commentator feed falls back to beIN 1. Reading it correctly comes down to two
 * things: pairing its fixture to ours, and picking the Arabic feed out of the
 * several editions it lists.
 */
describe("pairing goal.com's names against ESPN's", () => {
  it("folds the spellings the two sites actually disagree on", () => {
    // Each of these left a fixture unpaired on the first harvest.
    expect(sameTeam("Napoli", "SSC Napoli")).toBe(true);
    expect(sameTeam("Bayern Munich", "Bayern")).toBe(true);
    expect(sameTeam("Alavés", "Deportivo Alaves")).toBe(true);
    expect(sameTeam("Feyenoord Rotterdam", "Feyenoord")).toBe(true);
    expect(sameTeam("Bodo/Glimt", "Bodo Glimt")).toBe(true);
  });

  it("does not fold two clubs that share a city", () => {
    expect(sameTeam("Manchester United", "Manchester City")).toBe(false);
    expect(sameTeam("Real Madrid", "Real Sociedad")).toBe(false);
    expect(sameTeam("Atlético Madrid", "Real Madrid")).toBe(false);
  });

  it("refuses a name too short to be distinctive", () => {
    expect(sameTeam("Lens", "RC")).toBe(false);
    expect(sameTeam("A", "Arsenal")).toBe(false);
  });

  it("recognises the sides that share a club's name", () => {
    for (const name of ["SSC Napoli U19", "Arsenal U18", "Chelsea Academy", "Barcelona Women"]) {
      expect(isNonSeniorTeam(name), name).toBe(true);
    }
    expect(isNonSeniorTeam("Arsenal")).toBe(false);
    expect(isNonSeniorTeam("Manchester United")).toBe(false);
  });
});

describe("picking the channel out of goal.com's list", () => {
  it("takes the Arabic feed, not the English or French one", () => {
    // Barcelona v Feyenoord listed all three. Only the untagged name is the
    // channel this site streams; EN and FR carry their own numbering.
    expect(pickArabicBeinChannel(["beIN SPORTS 1", "beIN SPORTS EN 1", "beIN Sports FR 2"])).toEqual({
      channel: "beIN Sports 1",
      channelId: "bein-sports-1",
    });
    expect(pickArabicBeinChannel(["beIN SPORTS EN 1", "beIN SPORTS 3"])).toEqual({
      channel: "beIN Sports 3",
      channelId: "bein-sports-3",
    });
  });

  it("reads every number the site carries, not just 1 and 2", () => {
    for (const n of [1, 2, 3, 4]) {
      expect(pickArabicBeinChannel([`beIN SPORTS ${n}`]).channelId).toBe(`bein-sports-${n}`);
    }
  });

  it("keeps Max on its own numbering", () => {
    expect(pickArabicBeinChannel(["beIN SPORTS MAX 2"])).toEqual({
      channel: "beIN Max 2",
      channelId: "bein-max-2",
    });
  });

  it("returns nothing rather than a guess", () => {
    expect(pickArabicBeinChannel([])).toBeNull();
    expect(pickArabicBeinChannel(["Sky Sports Main Event", "beIN SPORTS EN 1"])).toBeNull();
    expect(pickArabicBeinChannel(null)).toBeNull();
  });
});

describe("matching a fixture to goal.com's listing", () => {
  const fixture = { kickoffUtc: "2026-09-09T19:00Z", home: "Napoli", away: "Arsenal" };
  const senior = { id: "g1", start: "2026-09-09T19:00:00.000Z", home: "SSC Napoli", away: "Arsenal" };
  const youth = { id: "g2", start: "2026-09-09T17:00:00.000Z", home: "SSC Napoli U19", away: "Arsenal U19" };

  it("finds the senior fixture", () => {
    expect(findGoalFixture(fixture, [youth, senior])?.id).toBe("g1");
  });

  it("never takes the youth fixture, even at the same kickoff", () => {
    const sameSlot = { ...youth, start: "2026-09-09T19:00:00.000Z" };
    expect(findGoalFixture(fixture, [sameSlot])).toBeNull();
  });

  it("will not pair across a different kickoff", () => {
    const later = { ...senior, start: "2026-09-09T21:00:00.000Z" };
    expect(findGoalFixture(fixture, [later])).toBeNull();
  });

  it("requires both teams to agree", () => {
    const wrongAway = { ...senior, away: "Aston Villa" };
    expect(findGoalFixture(fixture, [wrongAway])).toBeNull();
  });

  it("returns null on an unparseable kickoff instead of guessing", () => {
    expect(findGoalFixture({ kickoffUtc: "", home: "Napoli", away: "Arsenal" }, [senior])).toBeNull();
  });
});
