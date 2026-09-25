import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("watch playback priority", () => {
  it("mounts a ready match stream plan before generic IPTV Lab fallback", () => {
    const source = readFileSync(new URL("../assets/js/watch.js", import.meta.url), "utf8");
    const start = source.indexOf("async function loadPlayer()");
    const end = source.indexOf("function reloadPlayer()", start);
    const loadPlayer = source.slice(start, end);

    const plan = loadPlayer.indexOf("mountPlanSource(planSource, activePlan)");
    const lab = loadPlayer.indexOf("await mountLabChannel()");

    expect(plan).toBeGreaterThan(-1);
    expect(lab).toBeGreaterThan(-1);
    expect(plan).toBeLessThan(lab);
  });
});
