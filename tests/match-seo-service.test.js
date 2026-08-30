import { describe, expect, it } from "vitest";
import { matchSeoCacheSeconds, parseMatchSeoPath } from "../backend/services/match-seo.js";

describe("match SEO service", () => {
  it("uses distinct Arabic and English URLs for the same stable leaf", () => {
    expect(parseMatchSeoPath("/match/2026-09-05/newcastle-united-vs-afc-bournemouth")).toEqual({
      lang: "ar",
      day: "2026-09-05",
      arRoute: "/match/2026-09-05/newcastle-united-vs-afc-bournemouth",
    });
    expect(parseMatchSeoPath("/en/match/2026-09-05/newcastle-united-vs-afc-bournemouth")).toEqual({
      lang: "en",
      day: "2026-09-05",
      arRoute: "/match/2026-09-05/newcastle-united-vs-afc-bournemouth",
    });
  });

  it("refreshes live leaves quickly without changing the URL", () => {
    const now = Date.parse("2026-09-05T11:00:00Z");
    expect(matchSeoCacheSeconds({ status: "live", kickoffUtc: "2026-09-05T10:00:00Z" }, now)).toBe(30);
    expect(matchSeoCacheSeconds({ status: "ended", kickoffUtc: "2026-09-05T10:00:00Z" }, now)).toBe(3600);
    expect(matchSeoCacheSeconds({ status: "upcoming", kickoffUtc: "2026-09-05T12:00:00Z" }, now)).toBe(60);
  });
});
