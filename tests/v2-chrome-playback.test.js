import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const watch = readFileSync("assets/js/watch.js", "utf8");
const html = readFileSync("watch.html", "utf8");
const loader = readFileSync("assets/js/watch-loader.js", "utf8");

describe("V2 Chrome playback recovery wiring", () => {
  it("loads the V2 policy before the standard watch player loader", () => {
    const policy = html.indexOf("assets/js/v2-hls-policy.js");
    const watchLoader = html.indexOf("assets/js/watch-loader.js");
    expect(policy).toBeGreaterThanOrEqual(0);
    expect(watchLoader).toBeGreaterThan(policy);
    expect(loader).toContain('assets/js/watch.js?v=20261017channelguard1');
  });

  it("uses hls.js policy for V2 on non-Apple browsers", () => {
    const start = watch.indexOf("function mountPinnedMainMirror");
    const end = watch.indexOf("/**\n   * Play the match from our own Xtream line", start);
    const block = watch.slice(start, end);

    expect(block).toContain("window.KZ_V2_HLS_CONFIG");
    expect(block).toContain("window.KZV2Recovery.create");
    expect(block).toContain('String(navigator.vendor || "").startsWith("Apple")');
    expect(block).toContain("new window.Hls(window.KZ_V2_HLS_CONFIG)");
  });

  it("leaves non-V2 hls.js on the existing config", () => {
    const start = watch.indexOf("function mountPinnedMainMirror");
    const end = watch.indexOf("/**\n   * Play the match from our own Xtream line", start);
    const block = watch.slice(start, end);
    expect(block).toContain("new window.Hls({ enableWorker: false })");
  });

  it("never resumes V2 with a bare startLoad call", () => {
    const start = watch.indexOf("function mountPinnedMainMirror");
    const end = watch.indexOf("/**\n   * Play the match from our own Xtream line", start);
    const block = watch.slice(start, end);
    expect(block).toContain("hls.startLoad(v2ResumePosition(video))");
    expect(block).not.toMatch(/\.startLoad\(\s*\)/);
  });

  it("keeps the same-URL guard before the progress health exception", () => {
    const start = watch.indexOf("function v2PinnedMirrorAlreadyHealthy");
    const end = watch.indexOf("function mountPinnedMainMirror", start);
    const block = watch.slice(start, end);

    const sameUrl = block.indexOf("if (currentUrl !== href) return false;");
    const progress = block.indexOf("Date.now() - v2LastProgressAt < 20_000");
    expect(sameUrl).toBeGreaterThanOrEqual(0);
    expect(progress).toBeGreaterThan(sameUrl);
  });

  it("routes only V2 errors through recovery decisions", () => {
    const start = watch.indexOf("function mountPinnedMainMirror");
    const end = watch.indexOf("/**\n   * Play the match from our own Xtream line", start);
    const block = watch.slice(start, end);

    expect(block).toContain("const useV2Hls =");
    expect(block).toContain('console.warn("[KZ-V2]"');
    expect(block).toContain('decision.action === "resume-load"');
    expect(block).toContain('decision.action === "recover-media"');
    expect(block).toContain('decision.action === "swap-audio-and-recover"');
    expect(block).toContain('decision.action === "remount"');
  });
});
