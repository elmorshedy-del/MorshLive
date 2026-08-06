import { describe, expect, it } from "vitest";
import { extractBtolatMedia } from "../scripts/lib/btolat-media.js";

describe("btolat-media", () => {
  it("extracts vortex embed URL from embedURL JSON field", () => {
    const html = `"embedURL": "https://nvtboo.vortexvisionworks.com/embed/uiwKSSBLDhl6W"`;
    const media = extractBtolatMedia(html);
    expect(media?.source).toBe("vortex");
    expect(media?.embedId).toBe("uiwKSSBLDhl6W");
    expect(media?.videoUrl).toContain("uiwKSSBLDhl6W");
  });

  it("extracts beIN X tweet id when vortex embed is absent", () => {
    const html = `
      "embedURL": "2073496355004088721"
      <a href="https://x.com/beINSPORTS/status/2073496355004088721?ref_src=twsrc%5Etfw">
    `;
    const media = extractBtolatMedia(html);
    expect(media?.source).toBe("twitter");
    expect(media?.tweetId).toBe("2073496355004088721");
    expect(media?.videoUrl).toContain("2073496355004088721");
  });
});
