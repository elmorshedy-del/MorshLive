import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const watch = readFileSync("assets/js/watch.js", "utf8");

describe("V2 player lifecycle guards", () => {
  const mountStart = watch.indexOf("function mountPinnedMainMirror");
  const mountEnd = watch.indexOf("/**\n   * Play the match from our own Xtream line", mountStart);
  const mount = watch.slice(mountStart, mountEnd);

  it("invalidates old callbacks whenever the active player is destroyed", () => {
    const start = watch.indexOf("function destroyInlineHls");
    const end = watch.indexOf("function bindUnmuteOverlay", start);
    const destroy = watch.slice(start, end);
    expect(destroy).toContain("v2MountGeneration += 1;");
    expect(destroy.indexOf("v2MountGeneration += 1;")).toBeLessThan(destroy.indexOf("activeHls.destroy()"));
  });

  it("ignores errors and retry timers from a replaced HLS instance", () => {
    expect(mount).toContain("if (generation !== v2MountGeneration || activeHls !== hls || !data) return;");
    expect(mount).toContain("if (generation !== v2MountGeneration || activeHls !== hls) return;");
    const timerGuard = mount.indexOf("if (generation !== v2MountGeneration || activeHls !== hls) return;");
    const resume = mount.indexOf("hls.startLoad(v2ResumePosition(video))");
    expect(timerGuard).toBeGreaterThanOrEqual(0);
    expect(resume).toBeGreaterThan(timerGuard);
  });

  it("ignores progress events from a replaced HLS instance", () => {
    const progressStart = mount.indexOf('video.addEventListener("timeupdate"');
    const progressEnd = mount.indexOf("hls.on(window.Hls.Events.ERROR", progressStart);
    const progress = mount.slice(progressStart, progressEnd);
    expect(progress).toContain("generation !== v2MountGeneration");
    expect(progress).toContain("activeHls !== hls");
    expect(progress).toContain("tracker.noteProgress()");
    expect(progress).toContain("v2LastProgressAt = Date.now()");
  });

  it("serializes a V2 remount and prevents another one for the same URL inside 60 seconds", () => {
    expect(mount).toContain("v2RemountedAtByUrl.get(src)");
    expect(mount).toContain("now - previousRemount < V2_REMOUNT_WINDOW_MS");
    expect(mount).toContain("v2RemountedAtByUrl.set(src, now)");
    const clearLoaded = mount.indexOf('loadedUrl = "";');
    const destroy = mount.indexOf("destroyInlineHls();", clearLoaded);
    const remount = mount.indexOf("mountPinnedMainMirror(src", destroy);
    expect(clearLoaded).toBeGreaterThanOrEqual(0);
    expect(destroy).toBeGreaterThan(clearLoaded);
    expect(remount).toBeGreaterThan(destroy);
  });
});
