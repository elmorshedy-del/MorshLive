import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("sitemap inventory", () => {
  it("keeps the root sitemap focused on core and current schedule surfaces", () => {
    const sitemap = read("sitemap.xml");

    expect(sitemap).toContain("https://korazero.com/sitemap-core.xml");
    expect(sitemap).not.toContain("sitemap-wc-teams.xml");
    expect(sitemap).not.toContain("sitemap-wc-matches.xml");
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
