import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Real Madrid V2 matchday stability guard", () => {
  const watch = readFileSync("assets/js/watch.js", "utf8");

  it("keeps the exact Madrid V2 player mounted across metadata refreshes", () => {
    expect(watch).toContain('matchId !== "espn-esp.1-401882865"');
    expect(watch).toContain(
      'url !== "https://v2-mist-production.up.railway.app/hls/iptv-3645/index.m3u8"',
    );
    expect(watch).toContain("v2MatchdayPinnedMirrorAlreadyHealthy(url)");

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
