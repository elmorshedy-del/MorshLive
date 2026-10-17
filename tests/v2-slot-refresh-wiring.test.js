import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CI_DEPLOY_STEPS, FULL_CRAWL_STEPS } from "../lib/refresh-for-deploy.js";

const source = readFileSync("scripts/refresh-v2-bein-bindings.js", "utf8");

describe("V2 slot schedule refresh wiring", () => {
  it("reuses the existing beIN refresh step instead of adding a new deploy workflow step", () => {
    expect(CI_DEPLOY_STEPS).toContain("scripts/refresh-v2-bein-bindings.js");
    expect(FULL_CRAWL_STEPS).toContain("scripts/refresh-v2-bein-bindings.js");
    expect(source).toContain('import("../lib/v2-slot-allocator.js")');
    expect(source).toContain("v2-slot-schedule.json");
    expect(source).toContain("V2 slots:");
  });

  it("surfaces unmatched published beIN rows instead of silently dropping them", () => {
    expect(source).toContain("matchRowToFixture(row, fixtures)");
    expect(source).toContain("V2 beIN bindings: unmatched row");
  });

  it("keeps the two-slot count explicit and credentials out of generated schedule wiring", () => {
    expect(source).toContain('slots: ["a", "b"]');
    expect(source).not.toContain("V2_IPTV_USERNAME");
    expect(source).not.toContain("V2_IPTV_PASSWORD");
    expect(source).not.toContain("V2_IPTV_PORTAL_URL");
  });
});
