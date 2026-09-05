import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const watchJs = readFileSync(new URL("../assets/js/watch.js", import.meta.url), "utf8");

/** Where a call sits inside loadPlayer(), as a character offset. */
function offsetIn(haystack, needle) {
  const at = haystack.indexOf(needle);
  expect(at, `expected to find ${needle}`).toBeGreaterThan(-1);
  return at;
}

const loadPlayer = (() => {
  const start = offsetIn(watchJs, "async function loadPlayer()");
  const end = watchJs.indexOf("function reloadPlayer()", start);
  return watchJs.slice(start, end > start ? end : undefined);
})();

describe("loadPlayer source order", () => {
  const labAt = offsetIn(loadPlayer, "await mountLabChannel()");

  it("respects the gates that say this match must not play", () => {
    // Playing before these ran is how a channel button started a stream for a
    // match whose plan said waiting / conflict / Saudi-soon.
    for (const gate of ["saudiStreamComingSoon(match, activePlan)", 'activePlan.status === "waiting"']) {
      expect(offsetIn(loadPlayer, gate), `${gate} must be checked before our IPTV mounts`).toBeLessThan(
        labAt,
      );
    }
  });

  it("prefers our own IPTV over the third-party aggregator fallback", () => {
    expect(labAt).toBeLessThan(offsetIn(loadPlayer, "loadIframePlayer(embedUrlFor("));
  });

  it("still lets a verified operator plan win", () => {
    expect(offsetIn(loadPlayer, "planReady && mountPlanSource")).toBeLessThan(labAt);
  });
});

describe("the player's own settings stay out of routing changes", () => {
  it("mounts on the shared config and nothing hand-rolled", () => {
    // The continuity guard in watch-lab-continuity-guard.js wraps
    // mpegts.createPlayer and depends on this exact config and TS URL shape.
    expect(watchJs).toContain("window.KZ_LIVE_TS_CONFIG");
    expect(watchJs).not.toMatch(/stashInitialSize\s*:/);
    expect(watchJs).not.toMatch(/enableStashBuffer\s*:/);
    expect(watchJs).not.toMatch(/liveSync\s*:/);
  });
});
