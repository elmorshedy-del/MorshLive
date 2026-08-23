import { describe, expect, it } from "vitest";
import { buildSeoPages } from "../lib/seo-pages.js";

const payload = {
  date: "2026-08-23",
  matches: [
    {
      home: "Liverpool",
      away: "Arsenal",
      kickoffUtc: "2026-08-23T18:00:00Z",
      competition: "epl",
      status: "upcoming",
      score: "VS",
    },
    {
      home: "Liverpool",
      away: "Newcastle United",
      kickoffUtc: "2026-08-27T18:00:00Z",
      competition: "epl",
      status: "upcoming",
      score: "VS",
    },
  ],
};

describe("generated SEO page editorial polish", () => {
  it("does not expose search-engine implementation language to visitors", () => {
    const result = buildSeoPages(payload);
    const combined = result.pages.map((page) => page.html).join("\n");
    expect(combined).not.toContain("مقروء لمحركات البحث");
    expect(combined).not.toContain("صفحات ضعيفة أو مكررة");
    expect(combined).not.toContain("بدون الاعتماد على JavaScript");
  });

  it("uses the same dark visual direction as the main product", () => {
    const result = buildSeoPages(payload);
    expect(result.pages[0].html).toContain("color-scheme:dark");
    expect(result.pages[0].html).toContain("background:#060914");
  });
});
