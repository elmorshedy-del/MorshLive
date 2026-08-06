import { describe, expect, it } from "vitest";
import {
  matchFromSlug,
  matchPagePath,
  matchPageTitleAr,
  matchPageTitleEn,
  matchSlugFromTeams,
} from "../lib/wc-match-slug.js";

describe("wc-match-slug", () => {
  const matches = [
    { key: "morocco~netherlands", home: "Morocco", away: "Netherlands" },
    { key: "brazil~morocco", home: "Brazil", away: "Morocco" },
    { key: "mexico~southafrica", home: "Mexico", away: "South Africa" },
  ];

  it("builds sorted vs slugs for pretty URLs", () => {
    expect(matchSlugFromTeams("Morocco", "Netherlands")).toBe("morocco-vs-netherlands");
    expect(matchSlugFromTeams("Netherlands", "Morocco")).toBe("morocco-vs-netherlands");
    expect(matchSlugFromTeams("Mexico", "South Africa")).toBe("mexico-vs-south-africa");
  });

  it("resolves slug back to archive match", () => {
    expect(matchFromSlug("morocco-vs-netherlands", matches)?.key).toBe("morocco~netherlands");
    expect(matchFromSlug("brazil-vs-morocco", matches)?.key).toBe("brazil~morocco");
    expect(matchFromSlug("morocco", matches)).toBeNull();
  });

  it("builds match page paths", () => {
    expect(matchPagePath(matches[0])).toBe("/world-cup-2026/morocco-vs-netherlands");
    expect(matchPagePath("Brazil", "Morocco")).toBe("/world-cup-2026/brazil-vs-morocco");
  });

  it("builds SEO titles", () => {
    expect(matchPageTitleAr("المغرب", "هولندا")).toBe("ملخص مباراة المغرب وهولندا في كأس العالم 2026");
    expect(matchPageTitleEn("Morocco", "Netherlands")).toBe(
      "Morocco vs Netherlands — World Cup 2026 highlights",
    );
  });
});
