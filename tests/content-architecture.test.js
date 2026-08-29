import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const architecture = readFileSync("assets/js/content-architecture.js", "utf8");
const highlightsPage = readFileSync("highlights.html", "utf8");
const highlightsJs = readFileSync("assets/js/highlights-page.js", "utf8");
const searchJs = readFileSync("assets/js/search.js", "utf8");
const i18nLoader = readFileSync("assets/js/i18n.js", "utf8");
const seoPages = readFileSync("lib/seo-pages.js", "utf8");
const seoBuilder = readFileSync("scripts/build-seo-pages.mjs", "utf8");
const seasonArchive = readFileSync("scripts/update-season-highlights.mjs", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("KoraZero content architecture", () => {
  it("has separate primary destinations for current highlights and the World Cup archive", () => {
    expect(architecture).toContain("/highlights.html");
    expect(architecture).toContain("/tournament");
    expect(architecture).toContain('highlights: "الملخصات"');
    expect(architecture).toContain('worldCup: "كأس العالم 2026"');
  });

  it("routes the homepage highlights CTA to the dedicated highlights collection", () => {
    expect(architecture).toContain('allHighlights.href = "/highlights.html"');
    expect(architecture).not.toContain('home-tweets-more" href="/tournament"');
  });

  it("provides a dedicated current-season highlights and recap page", () => {
    expect(highlightsPage).toContain("ملخصات مباريات الموسم 2026/27");
    expect(highlightsPage).toContain('href="/tournament"');
    expect(highlightsJs).toContain('const SUPPORTED = new Set(["epl", "laliga", "ucl"])');
    expect(highlightsJs).toContain("isWorldCup(m)");
    expect(highlightsJs).toContain("/assets/data/season-highlights.json");
  });

  it("persists current-season highlights instead of limiting the collection to the three-day home rail", () => {
    expect(seasonArchive).toContain('const SUPPORTED = new Set(["epl", "laliga", "ucl"])');
    expect(seasonArchive).toContain("previous.season === currentSeason");
    expect(seasonArchive).toContain("season-highlights.json");
    expect(packageJson.scripts["refresh:matches:full"]).toContain("update-season-highlights.mjs");
  });

  it("never sends ended club search results into the World Cup archive", () => {
    expect(searchJs).toContain("if (isWorldCupMatch(m))");
    expect(searchJs).toContain("return currentRecapHref(m)");
    expect(searchJs).toContain("/highlights.html?match=");
  });

  it("normalizes legacy live shortcuts to the player rather than the World Cup archive", () => {
    expect(seoBuilder).toContain("normalizeLegacyRoutes");
    expect(seoBuilder).toContain('"/live               /watch?ch=live              301"');
    expect(seoBuilder).toContain('"/bein               /watch?ch=live              301"');
    expect(seoBuilder).toContain('"/vip                /watch?ch=live              301"');
  });

  it("loads the shared architecture everywhere and exposes highlights to generated SEO navigation", () => {
    expect(i18nLoader).toContain("content-architecture.js");
    expect(i18nLoader).toContain("content-architecture.css");
    expect(seoPages).toContain("ملخصات الموسم");
    expect(seoPages).toContain("/highlights.html</loc>");
  });
});
