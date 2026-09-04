import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const windowing = require("../assets/js/iptv-window.js");

const kickoff = "2026-09-04T18:00:00Z";
const match = { kickoffUtc: kickoff, status: "upcoming" };
const at = (minutes) => Date.parse(kickoff) + minutes * 60 * 1000;

describe("deterministic IPTV TV window", () => {
  it("keeps TV hidden until T-30", () => {
    expect(windowing.phase(match, at(-31))).toBe("details");
    expect(windowing.isEligible(match, at(-31))).toBe(false);
    expect(windowing.phase(match, at(-30))).toBe("pregame");
    expect(windowing.isEligible(match, at(-30))).toBe(true);
  });

  it("covers pregame, match and a postgame studio window", () => {
    expect(windowing.phase(match, at(-1))).toBe("pregame");
    expect(windowing.phase({ ...match, status: "live" }, at(0))).toBe("live");
    expect(windowing.phase(match, at(135))).toBe("live");
    expect(windowing.phase({ ...match, status: "ended" }, at(105))).toBe("postgame");
    expect(windowing.phase({ ...match, status: "ended" }, at(136))).toBe("postgame");
    expect(windowing.phase({ ...match, status: "ended" }, at(165))).toBe("postgame");
    expect(windowing.phase({ ...match, status: "ended" }, at(166))).toBe("after");
  });

  it("uses consistent card action stages", () => {
    expect(windowing.cardActionKey(match, at(-31))).toBe("card.matchCentre");
    expect(windowing.cardActionKey(match, at(-30))).toBe("card.watch");
    expect(windowing.cardActionKey({ ...match, status: "live" }, at(20))).toBe("card.watchNow");
    expect(windowing.cardActionKey({ ...match, status: "ended" }, at(105))).toBe("card.watchCommentary");
    expect(windowing.cardActionKey({ ...match, status: "ended" }, at(150))).toBe("card.watchCommentary");
    expect(windowing.cardActionKey({ ...match, status: "ended" }, at(166))).toBe("card.summary");
  });
});
