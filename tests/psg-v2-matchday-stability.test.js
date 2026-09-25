import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Khaleeji 27 V2 matchday stability guard", () => {
  const watch = readFileSync("assets/js/watch.js", "utf8");
  const hold = readFileSync("assets/js/watch-v2-hold.js", "utf8");

  it("covers every published group-stage fixture", () => {
    for (let id = 401922489; id <= 401922500; id += 1) {
      expect(watch).toContain(`"espn-global.gulf_cup-${id}"`);
      expect(hold).toContain(`"espn-global.gulf_cup-${id}"`);
    }
  });

  it("knows both verified V2 Al Kass HLS endpoints", () => {
    expect(watch).toContain("https://v2-mist-production.up.railway.app/hls/iptv-89778/index.m3u8");
    expect(watch).toContain("https://v2-mist-production.up.railway.app/hls/iptv-89779/index.m3u8");
    expect(watch).toContain("v2MatchdayPinnedMirrorAlreadyHealthy(url)");
  });

  it("checks the healthy-player guard before destroying HLS", () => {
    const mountStart = watch.indexOf("function mountPinnedMainMirror");
    const guardCall = watch.indexOf("v2MatchdayPinnedMirrorAlreadyHealthy(url)", mountStart);
    const destroyCall = watch.indexOf("destroyInlineHls();", mountStart);
    expect(mountStart).toBeGreaterThanOrEqual(0);
    expect(guardCall).toBeGreaterThan(mountStart);
    expect(destroyCall).toBeGreaterThan(guardCall);
  });

  it("does not change the existing muted autoplay policy", () => {
    expect(watch).toContain(
      'shell.innerHTML = `<video class="kz-main-video" controls autoplay muted playsinline webkit-playsinline></video>`;',
    );
  });
});
