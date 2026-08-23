import { describe, expect, it } from "vitest";
import { buildSeoPages, matchPagePath, slugify } from "../lib/seo-pages.js";

const teamNamesAr = {
  Arsenal: "أرسنال",
  Barcelona: "برشلونة",
  Elche: "إلتشي",
  Liverpool: "ليفربول",
  "Newcastle United": "نيوكاسل",
};

const payload = {
  date: "2026-08-23",
  matches: [
    {
      home: "Liverpool",
      away: "Newcastle United",
      kickoffUtc: "2026-08-23T15:00:00Z",
      competition: "epl",
      status: "upcoming",
      score: "VS",
      channel: "beIN Sports 1",
      commentator: "حفيظ دراجي",
    },
    {
      home: "Liverpool",
      away: "Arsenal",
      kickoffUtc: "2026-08-27T18:00:00Z",
      competition: "epl",
      status: "upcoming",
      score: "VS",
    },
    {
      home: "Barcelona",
      away: "Elche",
      kickoffUtc: "2026-08-23T20:00:00Z",
      competition: "laliga",
      status: "ended",
      score: "3 - 0",
    },
  ],
};

describe("seo-pages", () => {
  it("creates stable ASCII slugs and dated match URLs", () => {
    expect(slugify("Türkiye")).toBe("turkiye");
    expect(slugify("Newcastle United")).toBe("newcastle-united");
    expect(matchPagePath(payload.matches[0])).toBe("/match/2026-08-23/liverpool-vs-newcastle-united");
  });

  it("generates crawlable today, date, league and match pages", () => {
    const result = buildSeoPages(payload, { teamNamesAr });
    const routes = result.pages.map((page) => page.route);

    expect(routes).toContain("/matches/today");
    expect(routes).toContain("/matches/2026-08-23");
    expect(routes).toContain("/league/premier-league");
    expect(routes).toContain("/league/la-liga");
    expect(routes).toContain("/match/2026-08-23/liverpool-vs-newcastle-united");
  });

  it("only creates team pages when the current schedule has enough substance", () => {
    const result = buildSeoPages(payload, { teamNamesAr });
    const routes = result.pages.map((page) => page.route);

    expect(routes).toContain("/team/liverpool");
    expect(routes).not.toContain("/team/barcelona");
    expect(routes).not.toContain("/team/elche");
  });

  it("puts real match facts and SportsEvent structured data in the HTML", () => {
    const result = buildSeoPages(payload, { teamNamesAr });
    const page = result.pages.find(
      (candidate) => candidate.route === "/match/2026-08-23/liverpool-vs-newcastle-united",
    );

    expect(page.html).toContain("ليفربول ضد نيوكاسل");
    expect(page.html).toContain("beIN Sports 1");
    expect(page.html).toContain("حفيظ دراجي");
    expect(page.html).toContain('"@type":"SportsEvent"');
    expect(page.html).toContain(
      '<link rel="canonical" href="https://korazero.com/match/2026-08-23/liverpool-vs-newcastle-united">',
    );
  });

  it("publishes every generated route in both redirects and the schedule sitemap", () => {
    const result = buildSeoPages(payload, { teamNamesAr });

    expect(result.redirectLines).toContain("/matches/today  /generated/seo/matches-today.html  200");
    expect(result.sitemapXml).toContain("https://korazero.com/league/premier-league");
    expect(result.sitemapXml).toContain(
      "https://korazero.com/match/2026-08-23/liverpool-vs-newcastle-united",
    );
  });
});
