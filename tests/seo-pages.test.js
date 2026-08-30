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
      id: "espn-eng.1-1",
      home: "Liverpool",
      away: "Newcastle United",
      kickoffUtc: "2026-08-23T15:00:00Z",
      competition: "epl",
      leagueAr: "الدوري الإنجليزي الممتاز",
      status: "upcoming",
      score: "VS",
      channel: "beIN Sports 1",
      channelId: "bein-sports-1",
      commentator: "حفيظ دراجي",
      seoLastmod: "2026-08-23T14:00:00.000Z",
    },
    {
      id: "espn-eng.1-2",
      home: "Liverpool",
      away: "Arsenal",
      kickoffUtc: "2026-08-27T18:00:00Z",
      competition: "epl",
      leagueAr: "الدوري الإنجليزي الممتاز",
      status: "upcoming",
      score: "VS",
    },
    {
      id: "espn-esp.1-3",
      home: "Barcelona",
      away: "Elche",
      kickoffUtc: "2026-08-23T20:00:00Z",
      competition: "laliga",
      leagueAr: "الدوري الإسباني",
      status: "ended",
      score: "3 - 0",
    },
    {
      id: "espn-ksa.1-4",
      home: "Al Hilal",
      away: "Al Ahli",
      kickoffUtc: "2026-08-23T18:00:00Z",
      competition: "spl",
      leagueAr: "الدوري السعودي",
      status: "upcoming",
      score: "VS",
    },
  ],
};

describe("seo-pages", () => {
  it("creates stable ASCII slugs and dated match URLs", () => {
    expect(slugify("Türkiye")).toBe("turkiye");
    expect(slugify("Newcastle United")).toBe("newcastle-united");
    expect(matchPagePath(payload.matches[0])).toBe("/match/2026-08-23/liverpool-vs-newcastle-united");
  });

  it("generates a crawlable matches hub, date, league and match pages", () => {
    const result = buildSeoPages(payload, { teamNamesAr });
    const routes = result.pages.map((page) => page.route);

    expect(routes).toContain("/matches");
    expect(routes).toContain("/matches/2026-08-23");
    expect(routes).toContain("/league/premier-league");
    expect(routes).toContain("/league/la-liga");
    expect(routes).toContain("/league/saudi-pro-league");
    expect(routes).toContain("/match/2026-08-23/liverpool-vs-newcastle-united");
    expect(routes).toContain("/en/match/2026-08-23/liverpool-vs-newcastle-united");
    expect(routes).toContain("/matches/archive");
  });

  it("only creates team pages when the current schedule has enough substance", () => {
    const result = buildSeoPages(payload, { teamNamesAr });
    const routes = result.pages.map((page) => page.route);

    expect(routes).toContain("/team/liverpool");
    expect(routes).not.toContain("/team/barcelona");
    expect(routes).not.toContain("/team/elche");
  });

  it("puts real match facts, watch CTA and SportsEvent structured data in the HTML", () => {
    const result = buildSeoPages(payload, { teamNamesAr });
    const page = result.pages.find(
      (candidate) => candidate.route === "/match/2026-08-23/liverpool-vs-newcastle-united",
    );

    expect(page.html).toContain("ليفربول");
    expect(page.html).toContain("نيوكاسل");
    expect(page.html).toContain("beIN Sports 1");
    expect(page.html).toContain("حفيظ دراجي");
    expect(page.html).toContain("/watch?ch=bein-sports-1");
    expect(page.html).toContain('"@type":"SportsEvent"');
    expect(page.html).toContain(
      '<link rel="canonical" href="https://korazero.com/match/2026-08-23/liverpool-vs-newcastle-united">',
    );
  });

  it("uses the canonical tournament hub and exposes the permanent result archive", () => {
    const result = buildSeoPages(payload, { teamNamesAr });
    const hub = result.pages.find((page) => page.route === "/matches");
    const archive = result.pages.find((page) => page.route === "/matches/archive");

    expect(hub.html).toContain('<a href="/tournament">كأس العالم 2026</a>');
    expect(hub.html).not.toContain('<a href="/world-cup-2026">كأس العالم 2026</a>');
    expect(hub.html).toContain('href="/matches/archive"');
    expect(archive.html).toContain("/match/2026-08-23/barcelona-vs-elche");
    expect(archive.html).toContain("3 - 0");
  });

  it("publishes canonical hub routes and redirects the old today URL", () => {
    const result = buildSeoPages(payload, { teamNamesAr });

    expect(result.redirectLines).toContain("/matches  /generated/seo/matches-hub.html  200");
    expect(result.redirectLines).toContain("/matches/today  /matches  301");
    expect(result.sitemapXml).toContain("https://korazero.com/matches");
    expect(result.sitemapXml).toContain("https://korazero.com/league/premier-league");
    expect(result.sitemapXml).toContain("https://korazero.com/league/saudi-pro-league");
    expect(result.sitemapXml).toContain(
      "https://korazero.com/match/2026-08-23/liverpool-vs-newcastle-united",
    );
  });

  it("uses W3C lastmod only on leaves with a proven content-change timestamp", () => {
    const result = buildSeoPages(payload, { teamNamesAr });
    expect(result.sitemapXml).toContain("<lastmod>2026-08-23T14:00:00+00:00</lastmod>");
    const hubRow =
      result.sitemapXml.match(/<url><loc>https:\/\/korazero\.com\/matches<\/loc>(.*?)<\/url>/)?.[1] || "";
    expect(hubRow).not.toContain("lastmod");
  });
});
