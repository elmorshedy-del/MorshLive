import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const dictionary = require("../assets/data/team-names-ar.json");
const { createArabicTeamResolver } = require("../scripts/arabic-team-resolver.js");

const resolve = createArabicTeamResolver();

/**
 * The English side of team-names-ar.json is not a label — it is the join key
 * against ESPN's fixture names. A spelling that disagrees with ESPN cannot pair,
 * so the fixture reaches the site with no channel and no commentator, silently.
 *
 * "Internazionale" is the case that taught this: the dictionary said "Inter
 * Milan", ESPN says "Internazionale", and Real Madrid's Champions League tie
 * went unhydrated while its card rendered the away side in English on an
 * otherwise Arabic page.
 */
describe("team names join against ESPN", () => {
  // Verified against the ESPN scoreboard for September 2026 across every
  // competition this site covers. Renaming one of these breaks the join.
  const ESPN_NAMES = [
    "Internazionale",
    "AS Roma",
    "RB Leipzig",
    "VfB Stuttgart",
    "Feyenoord Rotterdam",
    "Shakhtar Donetsk",
    "Slavia Prague",
    "Como",
    "Lens",
    "Neom SC",
    "Abha",
    "Real Madrid",
    "Manchester City",
    "Borussia Dortmund",
    "LASK Linz",
    "Al Hilal",
  ];

  it.each(ESPN_NAMES)("knows %s by the name ESPN uses", (name) => {
    expect(dictionary[name], `${name} is missing from team-names-ar.json`).toBeTruthy();
  });

  it("resolves the Arabic back to ESPN's spelling, not a synonym", () => {
    // The resolver's output is compared against ESPN directly, so returning a
    // different-but-correct name for the club is still a failed join.
    expect(resolve("إنتر ميلان")).toBe("Internazionale");
    expect(resolve("نيوم")).toBe("Neom SC");
    expect(resolve("روما")).toBe("AS Roma");
  });

  // National sides are deliberately listed under both of their common English
  // names; canonicalEnglish() in the resolver folds most pairs together, and
  // these two it does not. They are outside the competitions this site joins
  // fixtures for, so they are recorded here rather than silently skipped.
  const NATIONAL_ALIASES = new Set(["تركيا", "كوراساو"]);

  it("gives each Arabic name exactly one English spelling", () => {
    // buildTeamIndex keys the reverse lookup by normalised Arabic and keeps the
    // first entry it sees, so two English spellings sharing one Arabic name
    // means the loser can never be resolved to. That is how "NEOM" shadowed
    // "Neom SC" — the ESPN name was in the file and still unreachable.
    const { canonicalEnglish } = require("../scripts/arabic-team-resolver.js");
    const byArabic = new Map();
    for (const [english, arabic] of Object.entries(dictionary)) {
      if (NATIONAL_ALIASES.has(arabic)) continue;
      const clash = byArabic.get(arabic);
      // A pair the resolver canonicalises to one name is harmless — both routes
      // end at the same English spelling. Anything else means the loser is
      // unreachable, which is how "Al-Faisaly" shadowed ESPN's "Al Faisaly".
      if (clash && canonicalEnglish(clash) === canonicalEnglish(english)) continue;
      expect(clash, `"${english}" and "${clash}" both map to "${arabic}"`).toBeUndefined();
      byArabic.set(arabic, english);
    }
  });

  it("has no blank entries on either side", () => {
    for (const [english, arabic] of Object.entries(dictionary)) {
      expect(english.trim()).not.toBe("");
      expect(String(arabic).trim()).not.toBe("");
    }
  });
});
