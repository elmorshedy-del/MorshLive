import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const matcher = require("../assets/js/iptv-epg-match-core.js");

const kickoff = Date.parse("2026-09-04T18:00:00Z");
const seconds = (ms) => Math.floor(ms / 1000);
const match = {
  id: "espn-ksa.1-1",
  home: "Al Hilal",
  away: "Al Shabab",
  kickoffUtc: new Date(kickoff).toISOString(),
  status: "upcoming",
};

function program(logicalKey, title, startOffsetMinutes = -30, stopOffsetMinutes = 150) {
  return {
    logicalKey,
    title,
    description: "",
    startTimestamp: seconds(kickoff + startOffsetMinutes * 60 * 1000),
    stopTimestamp: seconds(kickoff + stopOffsetMinutes * 60 * 1000),
  };
}

describe("deterministic provider EPG fallback", () => {
  it("requires both teams and coherent timing", () => {
    const hit = matcher.resolveProgramMatch(match, [
      program("thmanyah-1", "Al Hilal vs Al Shabab"),
      program("thmanyah-2", "Al Hilal studio"),
      program("thmanyah-3", "Al Nassr vs Al Ahli"),
    ]);

    expect(hit?.program.logicalKey).toBe("thmanyah-1");
    expect(hit.score).toBeGreaterThanOrEqual(matcher.MIN_SCORE);
  });

  it("rejects a two-team listing that is far from kickoff", () => {
    const hit = matcher.resolveProgramMatch(match, [
      program("thmanyah-1", "Al Hilal vs Al Shabab", 300, 420),
    ]);
    expect(hit).toBeNull();
  });

  it("fails closed when two channels are equally plausible", () => {
    const hit = matcher.resolveProgramMatch(match, [
      program("thmanyah-1", "Al Hilal vs Al Shabab"),
      program("thmanyah-2", "Al Hilal vs Al Shabab"),
    ]);
    expect(hit).toBeNull();
  });
});
