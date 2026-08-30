import { describe, expect, it } from "vitest";
import { isSaudiProLeagueMatch, saudiStreamComingSoon } from "../lib/saudi-stream-soon.js";

describe("isSaudiProLeagueMatch", () => {
  it("accepts competition key, ESPN slug, or id", () => {
    expect(isSaudiProLeagueMatch({ competition: "spl" })).toBe(true);
    expect(isSaudiProLeagueMatch({ leagueSlug: "ksa.1" })).toBe(true);
    expect(isSaudiProLeagueMatch({ id: "espn-ksa.1-401900377" })).toBe(true);
  });

  it("rejects European fixtures", () => {
    expect(isSaudiProLeagueMatch({ competition: "epl", id: "espn-eng.1-401879293" })).toBe(false);
    expect(isSaudiProLeagueMatch({ competition: "laliga", leagueSlug: "esp.1" })).toBe(false);
  });
});

describe("saudiStreamComingSoon", () => {
  const spl = { competition: "spl", id: "espn-ksa.1-401900377" };

  it("is true for Saudi matches without a playable plan", () => {
    expect(saudiStreamComingSoon(spl)).toBe(true);
    expect(saudiStreamComingSoon(spl, { status: "catalog" })).toBe(true);
    expect(saudiStreamComingSoon(spl, { status: "legacy" })).toBe(true);
    expect(saudiStreamComingSoon(spl, { status: "waiting" })).toBe(true);
  });

  it("is false once a verified or operator plan exists", () => {
    expect(saudiStreamComingSoon(spl, { status: "verified" })).toBe(false);
    expect(saudiStreamComingSoon(spl, { status: "operator" })).toBe(false);
  });

  it("never flags non-Saudi cards", () => {
    expect(saudiStreamComingSoon({ competition: "epl" }, { status: "legacy" })).toBe(false);
  });
});
