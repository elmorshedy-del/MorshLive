import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("V2 single-socket stability guard", () => {
  const watch = readFileSync("assets/js/watch.js", "utf8");
  const data = readFileSync("assets/js/data.js", "utf8");

  it("uses a generic same-URL guard for V2 Mist HLS", () => {
    expect(watch).toContain("const V2_MIST_HLS_RE");
    expect(watch).toContain('const currentUrl = String(loadedUrl || "").replace');
    expect(watch).toContain("if (currentUrl !== href) return false;");
    expect(watch).toContain("v2PinnedMirrorAlreadyHealthy(url)");
  });

  it("checks the healthy-player guard before destroying HLS", () => {
    const mountStart = watch.indexOf("function mountPinnedMainMirror");
    const guardCall = watch.indexOf("v2PinnedMirrorAlreadyHealthy(url)", mountStart);
    const destroyCall = watch.indexOf("destroyInlineHls();", mountStart);
    expect(mountStart).toBeGreaterThanOrEqual(0);
    expect(guardCall).toBeGreaterThan(mountStart);
    expect(destroyCall).toBeGreaterThan(guardCall);
  });

  it("pins only England-Spain as the current V2 matchday fixture", () => {
    const start = data.indexOf("const V2_MATCHDAY_FIXTURES");
    const end = data.indexOf("const V2_MATCHDAY_CHANNEL_IDS", start);
    const block = data.slice(start, end);
    expect(block).toContain('"espn-uefa.nations-401861066"');
    expect(block).toContain("iptv-3645");
    expect(block).not.toContain("espn-caf.nations_qual-401920038");
    expect(block).not.toContain("iptv-89778");
    expect(block).not.toContain("iptv-89779");
  });

  it("does not change the existing muted autoplay policy", () => {
    expect(watch).toContain(
      'shell.innerHTML = \`<video class="kz-main-video" controls autoplay muted playsinline webkit-playsinline></video>\`;',
    );
  });
});
