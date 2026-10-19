import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { goalMinute, normalizeMomentum, normalizeTimeline, scoreProgress } from "../lib/match-intel.js";
import { getSportradarIntel } from "../backend/adapters/sportradar-intelligence.js";

describe("Match Intelligence source integrity", () => {
  it("reconstructs documented goals without making up other events", () => {
    expect(goalMinute("90+5'")).toBe(95);
    expect(goalMinute("HT")).toBeNull();
    expect(scoreProgress([{ minute: "15'", side: "home" }, { minute: "49'", side: "away" }], 90)).toEqual([
      { minute: 0, home: 0, away: 0 },
      { minute: 15, home: 1, away: 0 },
      { minute: 49, home: 1, away: 1 },
      { minute: 90, home: 1, away: 1 },
    ]);
  });

  it("normalizes real Sportradar minute-by-minute momentum and never guesses missing points", () => {
    expect(normalizeMomentum({
      momentum: [
        { match_time: 2, value: "-32", competitor: "home" },
        { match_time: 1, value: "25", competitor: "away" },
        { match_time: 99, value: "999" },
      ],
    })).toEqual([
      { minute: 1, value: 25, side: "away" },
      { minute: 2, value: -32, side: "home" },
    ]);
    expect(normalizeMomentum({})).toEqual([]);
  });

  it("does not confuse a Sportradar timestamp with pitch event time", () => {
    expect(normalizeTimeline({ timeline: [
      { id: 123, type: "score_change", match_time: 85, match_clock: "84:59", competitor: "away", time: "2026-10-18T01:00:00Z" },
      { id: 124, type: "unknown_event", match_time: 85 },
    ] })).toEqual([
      { id: "123", type: "score_change", minute: 85, clock: "84:59", side: "away", description: "", player: "", x: null, y: null },
    ]);
  });

  it("makes zero upstream calls without explicitly licensed public display", async () => {
    let calls = 0;
    const result = await getSportradarIntel(
      { SPORTRADAR_API_KEY: "test-only-key" },
      "sr:sport_event:123",
      async () => { calls++; throw new Error("not called"); },
    );
    expect(result).toEqual({ available: false, reason: "not_enabled" });
    expect(calls).toBe(0);
  });

  it("registers a separate page module without editing streaming files or committing secrets", () => {
    const index = readFileSync("index.html", "utf8");
    const app = readFileSync("assets/js/app.js", "utf8");
    const browser = readFileSync("assets/js/match-intelligence.js", "utf8");
    expect(index).toContain('id="kz-match-intelligence"');
    expect(index).toContain("match-intelligence.css?v=20261019a");
    expect(index).toContain("match-intelligence.js?v=20261019a");
    expect(app).toContain("KZMatchIntelligence.update(MATCHES)");
    expect(browser).not.toContain("x-api-key");
    expect(browser).not.toContain("SPORTRADAR_API_KEY");
  });
});
