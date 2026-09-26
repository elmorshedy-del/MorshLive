import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("V2 playback path isolation", () => {
  const watch = readFileSync("assets/js/watch.js", "utf8");
  const catalog = JSON.parse(readFileSync("assets/data/stream-plans.json", "utf8"));
  const matchId = "espn-uefa.nations-401861066";
  const v2Host = "https://v2-mist-production.up.railway.app/hls/iptv-3645/index.m3u8";

  it("mounts a ready stream plan before any IPTV Lab lookup", () => {
    const loadStart = watch.indexOf("async function loadPlayer()");
    const planMount = watch.indexOf("if (planReady && mountPlanSource(planSource, activePlan))", loadStart);
    const labMount = watch.indexOf("if (await mountLabChannel()) return;", loadStart);
    expect(loadStart).toBeGreaterThanOrEqual(0);
    expect(planMount).toBeGreaterThan(loadStart);
    expect(labMount).toBeGreaterThan(planMount);
  });

  it("treats a pending V2 plan as V2 even when the fixture map does not know the match", () => {
    const selectorStart = watch.indexOf("function v2MatchdaySelected()");
    const selectorEnd = watch.indexOf("function mountPlanSource", selectorStart);
    const selector = watch.slice(selectorStart, selectorEnd);
    expect(selector).toContain("activePlan?.alternates");
    expect(selector).toContain("V2_MIST_HLS_RE.test(href)");
  });

  it("hard-stops V2 channels from the isolated IPTV Lab rail", () => {
    const labStart = watch.indexOf("async function mountLabChannel()");
    const labFetch = watch.indexOf("fetchLabChannel(channelId)", labStart);
    const v2Stop = watch.indexOf("if (v2MatchdaySelected()) return false;", labStart);
    expect(v2Stop).toBeGreaterThan(labStart);
    expect(v2Stop).toBeLessThan(labFetch);
  });

  it("fails closed if a V2 HLS plan points anywhere except V2 Mist", () => {
    expect(watch).toContain("if (v2MatchdaySelected() && !V2_MIST_HLS_RE.test(href)) return false;");
  });

  it("has exactly one source for the active match and it is the V2 Mist HLS URL", () => {
    const plan = catalog.plans.find((item) => item.matchId === matchId);
    expect(plan).toBeTruthy();
    expect(plan.policy.allowLegacy).toBe(false);
    expect(plan.sources).toHaveLength(1);
    expect(plan.sources[0]).toMatchObject({
      kind: "hls",
      role: "primary",
      status: "operator",
      url: v2Host,
    });
    expect(plan.sources[0].fallbackUrl).toBeUndefined();
  });
});
