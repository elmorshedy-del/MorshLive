import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const catalog = JSON.parse(readFileSync("assets/data/stream-plans.json", "utf8"));
const matchId = "espn-eng.league_cup-401921842";

describe("Liverpool-Chelsea V2 match plan", () => {
  it("binds the exact ESPN fixture to a single fail-closed beIN 1 source", () => {
    const matches = catalog.plans.filter((plan) => plan.matchId === matchId);
    expect(matches).toHaveLength(1);

    const [plan] = matches;
    expect(plan.kickoffUtc).toBe("2026-10-28T20:00:00Z");
    expect(plan.policy).toMatchObject({
      sameContentOnly: true,
      allowAutoHeal: false,
      allowUnverifiedFallback: false,
      allowLegacy: false,
    });
    expect(plan.sources).toHaveLength(1);
    expect(plan.sources[0]).toMatchObject({
      kind: "hls",
      profile: "hls-direct-v1",
      status: "pending",
      contentKey: `match:${matchId}`,
      url: "https://mist-v2.korazero.com/hls/iptv-3645/index.m3u8",
    });
    expect(plan.sources[0].fallbackUrl).toBeUndefined();
  });
});
