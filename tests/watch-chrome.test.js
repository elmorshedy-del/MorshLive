import { describe, expect, it } from "vitest";
import { allowLegacySourceChrome } from "../lib/watch-chrome.js";

describe("allowLegacySourceChrome", () => {
  it("keeps IPTV chrome in xtream mode", () => {
    expect(allowLegacySourceChrome({ xtream: true, matchId: "espn-1" })).toBe(true);
  });

  it("hides dead 24/7 options on a match-scoped watch URL", () => {
    expect(allowLegacySourceChrome({ matchId: "espn-eng.1-401879322" })).toBe(false);
  });

  it("hides them for a catalog plan even without a match id", () => {
    expect(allowLegacySourceChrome({ plan: { catalog: true, status: "operator" } })).toBe(false);
  });

  it("does not fall back to the old channel grid", () => {
    expect(allowLegacySourceChrome({})).toBe(false);
  });
});
