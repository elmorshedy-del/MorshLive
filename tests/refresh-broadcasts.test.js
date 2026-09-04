import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { nonSaudiFixtures } = require("../scripts/refresh-broadcasts");
const { attachCommentators, mergeCommentaryIndex } = require("../scripts/commentators-lib");

const COMMENTATORS_HTML = `
  <div class="mt-match">
    <span class="mt-team">ريال بيتيس</span>
    <span class="mt-time">21:00</span>
    <span class="mt-team">ريال مدريد</span>
    <div class="mt-info">
      <span class="mt-commentator">عصام الشوالي</span>
      <span class="mt-channel">beIN Sports 1</span>
    </div>
  </div>
  <div class="mt-match">
    <span class="mt-team">الهلال</span>
    <span class="mt-time">21:00</span>
    <span class="mt-team">الشباب</span>
    <div class="mt-info">
      <span class="mt-commentator">فلان الفلاني</span>
      <span class="mt-channel">ثمانية 1</span>
    </div>
  </div>
`;

describe("general broadcast refresh", () => {
  it("filters Saudi Pro League fixtures out before hydrating channels", () => {
    const matches = [
      {
        id: "espn-esp.1-1",
        competition: "laliga",
        leagueSlug: "esp.1",
        home: "Real Betis",
        away: "Real Madrid",
      },
      { id: "espn-ksa.1-1", competition: "spl", leagueSlug: "ksa.1", home: "Al Hilal", away: "Al Shabab" },
    ];
    const filtered = nonSaudiFixtures(matches);
    expect(filtered.map((m) => m.id)).toEqual(["espn-esp.1-1"]);
  });

  it("resolves a live commentator feed into a canonical bein-sports channel for a non-Saudi match", () => {
    const matches = nonSaudiFixtures([
      {
        id: "espn-esp.1-1",
        competition: "laliga",
        leagueSlug: "esp.1",
        home: "Real Betis",
        away: "Real Madrid",
      },
      { id: "espn-ksa.1-1", competition: "spl", leagueSlug: "ksa.1", home: "Al Hilal", away: "Al Shabab" },
    ]);

    const { matched, commentaryIndex } = attachCommentators(matches, COMMENTATORS_HTML);

    expect(matched).toBe(1);
    expect(commentaryIndex).toHaveLength(1);
    expect(commentaryIndex[0]).toMatchObject({
      key: "realbetis~realmadrid",
      channel: "beIN Sports 1",
      channelId: "bein-sports-1",
      broadcast: { provider: "bein", channelId: "bein-sports-1", source: "almaghrebsport" },
    });
  });

  it("leaves every existing Saudi commentaryIndex row untouched when merging", () => {
    const matches = nonSaudiFixtures([
      {
        id: "espn-esp.1-1",
        competition: "laliga",
        leagueSlug: "esp.1",
        home: "Real Betis",
        away: "Real Madrid",
      },
    ]);
    const { commentaryIndex: fresh } = attachCommentators(matches, COMMENTATORS_HTML);

    const previous = [
      {
        key: "alhilal~alshabab",
        home: "Al Hilal",
        away: "Al Shabab",
        channel: "ثمانية 2",
        broadcast: {
          provider: "thmanyah",
          channelId: "thmanyah-2",
          source: "almaghrebsport",
          confidence: "exact",
        },
      },
    ];

    const merged = mergeCommentaryIndex(fresh, previous, matches);

    expect(merged.find((row) => row.key === "alhilal~alshabab")).toEqual({
      ...previous[0],
      locked: false,
    });
    expect(merged.find((row) => row.key === "realbetis~realmadrid")).toMatchObject({
      channelId: "bein-sports-1",
    });
  });
});
