import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("V2 plan single-socket policy", () => {
  const catalog = JSON.parse(readFileSync("assets/data/stream-plans.json", "utf8"));

  it("has exactly one operator or verified V2 Mist source", () => {
    const live = [];
    for (const plan of catalog.plans || []) {
      for (const source of plan.sources || []) {
        const url = String(source.url || "");
        if (!url.startsWith("https://v2-mist-production.up.railway.app/hls/iptv-")) continue;
        if (!["operator", "verified"].includes(source.status)) continue;
        live.push({ matchId: plan.matchId, url, status: source.status, role: source.role });
      }
    }

    expect(live).toEqual([
      {
        matchId: "espn-uefa.nations-401861066",
        url: "https://v2-mist-production.up.railway.app/hls/iptv-3645/index.m3u8",
        status: "operator",
        role: "primary",
      },
    ]);
  });
});
