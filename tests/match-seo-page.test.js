import { describe, expect, it } from "vitest";
import { buildMatchSeoHtml } from "../lib/match-seo-page.js";

const teamNamesAr = { "Newcastle United": "نيوكاسل", "AFC Bournemouth": "بورنموث" };

function match(status, extra = {}) {
  return {
    id: "espn-eng.1-401879286",
    status,
    seoEventStatus: "EventScheduled",
    home: "Newcastle United",
    away: "AFC Bournemouth",
    homeAbbr: "NEW",
    awayAbbr: "BOU",
    kickoffUtc: "2026-09-05T11:30:00Z",
    league: "English Premier League",
    leagueAr: "الدوري الإنجليزي الممتاز",
    competition: "epl",
    score: status === "upcoming" ? "VS" : "2 - 1",
    venueInfo: {
      name: "St. James' Park",
      city: "Newcastle-upon-Tyne",
      country: "England",
      streetAddress: "",
    },
    homeTeamInfo: {
      id: "361",
      name: "Newcastle United",
      url: "https://www.espn.com/soccer/club/_/id/361/newcastle-united",
    },
    awayTeamInfo: {
      id: "349",
      name: "AFC Bournemouth",
      url: "https://www.espn.com/soccer/club/_/id/349/afc-bournemouth",
    },
    headToHead: { summary: "NEW leads series 2-1-2", totalCompetitions: 5 },
    recentForm: {
      home: [{ result: "W", opponent: "Arsenal", score: "2-0" }],
      away: [{ result: "D", opponent: "Chelsea", score: "1-1" }],
    },
    ...extra,
  };
}

function htmlFor(status, extra = {}, lang = "ar") {
  const route =
    lang === "ar"
      ? "/match/2026-09-05/newcastle-united-vs-afc-bournemouth"
      : "/en/match/2026-09-05/newcastle-united-vs-afc-bournemouth";
  return buildMatchSeoHtml({
    match: match(status, extra),
    route,
    siteUrl: "https://korazero.com",
    teamNamesAr,
    lang,
  });
}

describe("server-rendered match page HTML", () => {
  it("renders a complete pre-match Arabic page without JavaScript", () => {
    const html = htmlFor("upcoming");
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain("نيوكاسل");
    expect(html).toContain("بورنموث");
    expect(html).toContain("الدوري الإنجليزي الممتاز");
    expect(html).toContain("مكة المكرمة");
    expect(html).toContain("الإمارات");
    expect(html).toContain("مصر");
    expect(html).toContain("المملكة المتحدة");
    expect(html).toContain("St. James&#39; Park");
    expect(html).toContain("المواجهات المباشرة");
    expect(html).toContain("آخر المباريات");
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("TBD");
    expect(html).not.toContain("الإصابات");
    expect(html).not.toContain("التشكيل المتوقع");
  });

  it("renders live score and scorer content while retaining pre-match facts", () => {
    const html = htmlFor("live", { minute: "67'", goals: [{ scorer: "A. Gordon", minute: "42'" }] });
    expect(html).toContain("النتيجة المباشرة");
    expect(html).toContain("2 - 1");
    expect(html).toContain("A. Gordon");
    expect(html).toContain("42&#39;");
    expect(html).toContain("موعد المباراة");
    expect(html).toContain("تفاصيل المباراة");
  });

  it("renders a finished result, scorers and real highlight while retaining pre-match content", () => {
    const html = htmlFor("ended", {
      goals: [{ scorer: "A. Gordon", minute: "42'" }],
      highlight: { videoUrl: "https://example.com/highlight", title: "ملخص المباراة" },
    });
    expect(html).toContain("النتيجة النهائية");
    expect(html).toContain("A. Gordon");
    expect(html).toContain("https://example.com/highlight");
    expect(html).toContain("المواجهات المباشرة");
    expect(html).toContain("موعد المباراة");
  });

  it("publishes reciprocal language URLs and a distinct English page", () => {
    const ar = htmlFor("upcoming");
    const en = htmlFor("upcoming", {}, "en");
    expect(ar).toContain(
      'hreflang="en" href="https://korazero.com/en/match/2026-09-05/newcastle-united-vs-afc-bournemouth"',
    );
    expect(ar).toContain(
      'hreflang="x-default" href="https://korazero.com/match/2026-09-05/newcastle-united-vs-afc-bournemouth"',
    );
    expect(en).toContain('<html lang="en" dir="ltr">');
    expect(en).toContain(
      'rel="canonical" href="https://korazero.com/en/match/2026-09-05/newcastle-united-vs-afc-bournemouth"',
    );
  });

  it("does not emit incomplete Event location schema", () => {
    const html = htmlFor("upcoming");
    const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    const schema = JSON.parse(json);
    const event = schema["@graph"].find((node) => node["@type"] === "SportsEvent");
    const breadcrumb = schema["@graph"].find((node) => node["@type"] === "BreadcrumbList");
    expect(event.name).toBe("نيوكاسل ضد بورنموث");
    expect(event.startDate).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(event.homeTeam).toMatchObject({ "@type": "SportsTeam" });
    expect(event.awayTeam).toMatchObject({ "@type": "SportsTeam" });
    expect(event.location).toBeUndefined();
    expect(breadcrumb.itemListElement).toHaveLength(3);
  });
});
