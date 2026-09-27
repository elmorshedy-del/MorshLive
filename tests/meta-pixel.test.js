import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pixelSrc = "/assets/js/meta-pixel.js?v=20260927";

describe("Meta Pixel wiring", () => {
  it("initializes the requested pixel and tracks PageView", () => {
    const source = read("assets/js/meta-pixel.js");
    expect(source).toContain('fbq("init", "2344222863048329")');
    expect(source).toContain('fbq("track", "PageView")');
  });

  it.each([
    "index.html",
    "highlights.html",
    "search.html",
    "tournament.html",
    "world-cup-match.html",
    "world-cup-team.html",
    "bein-lab.html",
  ])("loads the pixel on public page %s", (path) => {
    expect(read(path)).toContain(pixelSrc);
  });

  it("loads the pixel through the shared bootstrap used by the locked watch page", () => {
    expect(read("assets/js/i18n.js")).toContain(pixelSrc);
    expect(read("watch.html")).toContain("assets/js/i18n.js");
    expect(read("watch.html")).not.toContain(pixelSrc);
  });

  it.each([
    "lib/seo-pages.js",
    "lib/seo-pages-core.js",
    "lib/match-seo-page.js",
  ])("loads the pixel in generated page template %s", (path) => {
    expect(read(path)).toContain(pixelSrc);
  });
});
