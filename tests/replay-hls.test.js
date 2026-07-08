import { describe, expect, it } from "vitest";
import { resolveStreamUrl, rewriteReplayM3u8 } from "../lib/replay-hls.js";

describe("resolveStreamUrl", () => {
  it("resolves relative m3u8 against manifest base", () => {
    const base =
      "https://hlsx2.flashframenetwork.com/upfiles/source/hls/132/318271/manifest/master.m3u8?token=abc";
    expect(resolveStreamUrl("360p.m3u8?token=abc", base)).toBe(
      "https://hlsx2.flashframenetwork.com/upfiles/source/hls/132/318271/manifest/360p.m3u8?token=abc",
    );
  });
});

describe("rewriteReplayM3u8", () => {
  it("rewrites relative variant lines through proxy", () => {
    const manifest =
      "https://hlsx2.flashframenetwork.com/upfiles/source/hls/132/318271/manifest/master.m3u8?token=abc";
    const sample = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n360p.m3u8?token=abc\n720p.m3u8?token=abc";
    const origin = "https://korazero.com";
    const out = rewriteReplayM3u8(
      sample,
      manifest,
      origin,
      (abs) => `${origin}/replay/asset?u=${encodeURIComponent(abs)}`,
    );
    expect(out).toContain("/replay/asset?u=");
    expect(out).not.toMatch(/^360p\.m3u8/m);
  });
});
