import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { TeamNames } = require("../assets/js/team-names.js");
const { BEIN_COMPETITIONS } = require("../scripts/v2-bein-bindings-lib.js");

const priority = JSON.parse(readFileSync("assets/data/v2-match-priority.json", "utf8"));
const pins = JSON.parse(readFileSync("assets/data/v2-slot-pins.json", "utf8"));
const staticArabic = JSON.parse(readFileSync("assets/data/team-names-ar.json", "utf8"));

function pairKey(left, right) {
  return [left, right].sort().join("~");
}

describe("V2 match priority policy", () => {
  it("uses only supported beIN competitions and non-negative integer weights", () => {
    for (const [competition, weight] of Object.entries(priority.competition || {})) {
      expect(BEIN_COMPETITIONS.has(competition), competition).toBe(true);
      expect(Number.isInteger(weight), competition).toBe(true);
      expect(weight, competition).toBeGreaterThanOrEqual(0);
    }
    for (const key of ["tier1", "tier2", "rivalryBonus", "bigGameBonus"]) {
      expect(Number.isInteger(priority[key]), key).toBe(true);
      expect(priority[key], key).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps tier membership disjoint and every configured team Arabic-resolvable", () => {
    const tier1 = new Set(priority.teams?.tier1 || []);
    const tier2 = new Set(priority.teams?.tier2 || []);

    for (const team of tier1) {
      expect(tier2.has(team), team).toBe(false);
      expect(TeamNames.arabicFor(team), team).toBeTruthy();
    }
    for (const team of tier2) {
      expect(TeamNames.arabicFor(team), team).toBeTruthy();
    }
  });

  it("defines distinct, non-duplicated rivalry pairs with Arabic-resolvable teams", () => {
    const seen = new Set();
    for (const rivalry of priority.rivalries || []) {
      expect(Array.isArray(rivalry)).toBe(true);
      expect(rivalry).toHaveLength(2);
      const [left, right] = rivalry;
      expect(left).not.toBe(right);
      expect(TeamNames.arabicFor(left), left).toBeTruthy();
      expect(TeamNames.arabicFor(right), right).toBeTruthy();
      const key = pairKey(left, right);
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it("adds the five Champions League name gaps found in the Oct 14 replay", () => {
    const expected = {
      "AS Roma": "روما",
      "Feyenoord Rotterdam": "فيينورد",
      Como: "كومو",
      "Shakhtar Donetsk": "شاختار دونتسك",
      "VfB Stuttgart": "شتوتجارت",
    };
    for (const [team, arabic] of Object.entries(expected)) {
      expect(TeamNames.arabicFor(team), team).toBe(arabic);
      expect(staticArabic[team], team).toBe(arabic);
    }
  });

  it("keeps manual pins limited to must or never", () => {
    for (const [matchId, value] of Object.entries(pins)) {
      expect(matchId.length).toBeGreaterThan(0);
      expect(["must", "never"]).toContain(value);
    }
  });
});
