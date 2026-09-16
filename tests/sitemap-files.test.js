import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("sitemap inventory", () => {
  // These two were held out of the index while every /world-cup-2026/ URL
  // served one shared shell — 152 duplicates with a canonical pointing at a
  // 404 are not worth submitting. They are pre-rendered per slug now, so the
  // hold no longer applies; the guard below is what keeps that honest.
  it("submits the World Cup sitemaps only while their pages are pre-rendered", () => {
    const sitemap = read("sitemap.xml");

    expect(sitemap).toContain("https://korazero.com/sitemap-core.xml");
    expect(sitemap).toContain("https://korazero.com/sitemap-wc-matches.xml");
    expect(sitemap).toContain("https://korazero.com/sitemap-wc-teams.xml");

    // `generated/` is built, not committed, so check the routing that points at
    // it: every slug must have its own file rather than the shared shell.
    const redirects = read("_redirects");
    expect(redirects).not.toMatch(/^\/world-cup-2026\/\S+\s+\/world-cup-(match|team)\.html\?/m);

    const { matches } = JSON.parse(read("assets/data/wc-matches-index.json"));
    for (const slug of matches.map((match) => match.slug)) {
      expect(redirects).toContain(`/world-cup-2026/${slug}  /generated/seo/wc/match-${slug}.html`);
    }
  });

  it("does not submit utility search or playback pages as core landing pages", () => {
    const core = read("sitemap-core.xml");

    expect(core).toContain("<loc>https://korazero.com/</loc>");
    expect(core).toContain("<loc>https://korazero.com/tournament</loc>");
    expect(core).not.toContain("<loc>https://korazero.com/watch</loc>");
    expect(core).not.toContain("<loc>https://korazero.com/search</loc>");
    expect(core).not.toContain("<priority>");
    expect(core).not.toContain("<changefreq>");
  });
});
