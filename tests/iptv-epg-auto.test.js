import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const matcher = require("../assets/js/iptv-epg-auto.js");

describe("IPTV EPG fixture matching", () => {
  const kickoff = "2026-09-03T19:55:00Z";

  it("matches both teams despite punctuation and club suffix differences", () => {
    const match = {
      home: "Al-Fayha FC",
      away: "Al Kholood",
      status: "live",
      kickoffUtc: kickoff,
    };
    const program = {
      logicalKey: "epg:ssc1.sa",
      title: "Saudi Pro League: Al Fayha vs Al-Kholood",
      startTimestamp: Date.parse(kickoff) / 1000,
      stopTimestamp: Date.parse(kickoff) / 1000 + 2 * 60 * 60,
      nowPlaying: true,
    };

    expect(matcher.programMatchScore(match, program)).toBeGreaterThanOrEqual(200);
  });

  it("can use localized aliases when the EPG is Arabic", () => {
    const match = {
      home: "Al-Fayha",
      away: "Al Kholood",
      homeAliases: ["الفيحاء"],
      awayAliases: ["الخلود"],
      status: "live",
      kickoffUtc: kickoff,
    };
    const program = {
      logicalKey: "epg:ssc1.sa",
      title: "الدوري السعودي: الفيحاء × الخلود",
      startTimestamp: Date.parse(kickoff) / 1000,
      stopTimestamp: Date.parse(kickoff) / 1000 + 2 * 60 * 60,
      nowPlaying: true,
    };

    expect(matcher.programMatchScore(match, program)).toBeGreaterThanOrEqual(200);
  });

  it("rejects a program when only one team matches", () => {
    const match = {
      home: "Al-Fayha",
      away: "Al Kholood",
      status: "live",
      kickoffUtc: kickoff,
    };
    const program = {
      logicalKey: "epg:ssc2.sa",
      title: "Al-Fayha vs Al-Hilal",
      startTimestamp: Date.parse(kickoff) / 1000,
      stopTimestamp: Date.parse(kickoff) / 1000 + 2 * 60 * 60,
      nowPlaying: true,
    };

    expect(matcher.programMatchScore(match, program)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("fails closed when two different logical channels are equally plausible", () => {
    const match = {
      home: "Al-Fayha",
      away: "Al Kholood",
      status: "live",
      kickoffUtc: kickoff,
    };
    const base = {
      title: "Al-Fayha vs Al Kholood",
      startTimestamp: Date.parse(kickoff) / 1000,
      stopTimestamp: Date.parse(kickoff) / 1000 + 2 * 60 * 60,
      nowPlaying: true,
    };

    expect(
      matcher.resolveProgramMatch(match, [
        { ...base, logicalKey: "epg:ssc1.sa" },
        { ...base, logicalKey: "epg:ssc2.sa" },
      ]),
    ).toBeNull();
  });
});
