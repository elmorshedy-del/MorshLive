import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createArabicTeamResolver } = require("../scripts/arabic-team-resolver.js");

const resolve = createArabicTeamResolver();

/**
 * The commentator feed is the only source of European channel assignments, and
 * it writes Arabic. Every name it uses that this resolver cannot place is a
 * fixture that reaches the site with no channel — and every name it places
 * wrongly is a fixture bound to another competition's stream.
 */
describe("Arabic team resolver", () => {
  describe("short forms the feed actually writes", () => {
    // All three are in team-names-ar.json under their full names, far beyond
    // any sane edit distance from the short form the feed uses.
    it.each([
      ["لاسك", "LASK Linz"],
      ["دورتموند", "Borussia Dortmund"],
      ["نيوكاسل", "Newcastle United"],
    ])("resolves %s", (arabic, english) => {
      expect(resolve(arabic)).toBe(english);
    });
  });

  describe("refuses to invent a match", () => {
    // These are real clubs absent from the dictionary. Each previously resolved
    // to an unrelated entry: Lille to Wales, Boca to Panama, and the Egyptian
    // club ZED to Al Hazem — which would have handed a Saudi fixture an
    // Egyptian channel. A miss leaves a card unhydrated; a wrong hit sends a
    // viewer to another competition.
    it.each(["بوكا", "ميلوول", "سموحة", "سيراميكا"])("returns null for %s", (arabic) => {
      expect(resolve(arabic)).toBeNull();
    });

    it("does not let a two-letter name reach a real club", () => {
      expect(resolve("زد")).toBeNull();
    });
  });

  describe("keeps the names it already resolved", () => {
    it.each([
      ["ريال مدريد", "Real Madrid"],
      ["برشلونة", "Barcelona"],
      ["مانشستر سيتي", "Manchester City"],
      ["ليفربول", "Liverpool"],
      ["أستون فيلا", "Aston Villa"],
      ["إنتر ميلان", "Internazionale"],
      ["الهلال", "Al Hilal"],
      ["ويلز", "Wales"],
    ])("resolves %s", (arabic, english) => {
      expect(resolve(arabic)).toBe(english);
    });
  });

  it("places Lille without disturbing the names it sits inside", () => {
    // Lille is short enough that containment could swallow it into a longer
    // name, or let it swallow one.
    expect(resolve("ليل")).toBe("Lille");
    expect(resolve("ليفربول")).toBe("Liverpool");
    expect(resolve("ويلز")).toBe("Wales");
  });

  it("still forgives a spelling variant on a long name", () => {
    // The fuzzy pass is what handles hamza and transliteration drift; tightening
    // the short-name threshold must not have removed it.
    expect(resolve("مانشستر يونايتد")).toBe("Manchester United");
    expect(resolve("اتلتيكو مدريد")).toBe("Atlético Madrid");
  });

  it("returns null for empty or non-Arabic input", () => {
    for (const value of ["", "   ", null, undefined, "Real Madrid"]) {
      expect(resolve(value)).toBeNull();
    }
  });
});
