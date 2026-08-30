import { describe, expect, it } from "vitest";
import { injectTournamentArchiveLinks, renderTournamentArchiveLinks } from "../lib/tournament-seo.js";

const index = {
  matchCount: 2,
  matches: [
    { path: "/world-cup-2026/mexico-vs-south-africa", home: "Mexico", away: "South Africa", homeAr: "المكسيك", awayAr: "جنوب أفريقيا", score: "2 - 0" },
    { path: "/world-cup-2026/brazil-vs-morocco", home: "Brazil", away: "Morocco", homeAr: "البرازيل", awayAr: "المغرب", score: "1 - 1" },
  ],
};

describe("World Cup archive SEO", () => {
  it("renders crawlable match links without JavaScript", () => {
    const html = renderTournamentArchiveLinks(index);
    expect(html).toContain("أرشيف كأس العالم 2026 · 2 مباراة");
    expect(html).toContain('href="/world-cup-2026/mexico-vs-south-africa"');
    expect(html).toContain("المكسيك ضد جنوب أفريقيا");
  });

  it("injects the archive before main closes and remains idempotent", () => {
    const source = "<html><body><main><h1>Archive</h1></main></body></html>";
    const once = injectTournamentArchiveLinks(source, index);
    const twice = injectTournamentArchiveLinks(once, index);
    expect(once).toBe(twice);
    expect(once.indexOf("أرشيف كأس العالم")).toBeLessThan(once.indexOf("</main>"));
  });
});
