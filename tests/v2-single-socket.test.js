import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("V2 plan single-socket policy", () => {
  const catalog = JSON.parse(readFileSync("assets/data/stream-plans.json", "utf8"));
  const service = readFileSync("backend/services/stream-plan.js", "utf8");
  const v2Prefix = "https://v2-mist-production.up.railway.app/hls/iptv-";

  it("keeps every static V2 match mapping fail-closed and single-source", () => {
    const v2Plans = [];

    for (const plan of catalog.plans || []) {
      const sources = (plan.sources || []).filter((source) =>
        String(source.url || "").startsWith(v2Prefix),
      );
      if (!sources.length) continue;

      v2Plans.push(plan.matchId);
      expect(plan.policy?.allowLegacy, plan.matchId).toBe(false);
      expect(sources, plan.matchId).toHaveLength(1);

      const [source] = sources;
      expect(source.kind, plan.matchId).toBe("hls");
      expect(["primary", "alternate"], plan.matchId).toContain(source.role);
      expect(["pending", "operator", "verified"], plan.matchId).toContain(source.status);
      expect(source.fallbackUrl, plan.matchId).toBeUndefined();
    }

    expect(v2Plans.length).toBeGreaterThan(0);
  });

  it("uses controller state as the runtime authority for the one active V2 socket", () => {
    expect(service).toContain("https://v2-control-production.up.railway.app/api/active");
    expect(service).toContain("function gateV2Plan(plan, state)");
    expect(service).toContain("const activeChannelId = state?.activeChannelId || null");
    expect(service).toContain("selected: null");
    expect(service).toContain("v2-remote-other:");
    expect(service).toContain("v2-remote-off");
  });
});
