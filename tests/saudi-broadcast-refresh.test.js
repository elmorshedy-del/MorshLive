const { describe, expect, it } = require("vitest");
const {
  mergeCommentaryIndex,
  preservePreviousExact,
  rowsChanged,
} = require("../scripts/refresh-saudi-broadcasts");

describe("Saudi broadcast refresh merge", () => {
  it("pins a previous exact numbered channel through a temporary generic fallback", () => {
    const previous = [
      {
        id: "espn-ksa.1-1",
        key: "alhilal~alnassr",
        home: "Al Hilal",
        away: "Al Nassr",
        kickoffUtc: "2026-09-05T18:00:00Z",
        channel: "ثمانية 2",
        broadcast: {
          provider: "thmanyah",
          channelId: "thmanyah-2",
          source: "almaghrebsport",
          confidence: "exact",
        },
      },
    ];
    const fresh = [
      {
        ...previous[0],
        channel: "ثمانية",
        broadcast: {
          provider: "thmanyah",
          channelId: "thmanyah",
          source: "spl-rights-holder",
          confidence: "network",
        },
      },
    ];

    const [result] = preservePreviousExact(fresh, previous);
    expect(result.channel).toBe("ثمانية 2");
    expect(result.broadcast.channelId).toBe("thmanyah-2");
    expect(result.broadcast.source).toContain(":pinned");
  });

  it("lets a fresh exact assignment replace an older exact assignment", () => {
    const previous = [
      {
        id: "espn-ksa.1-1",
        key: "alhilal~alnassr",
        kickoffUtc: "2026-09-05T18:00:00Z",
        channel: "ثمانية 1",
        broadcast: { provider: "thmanyah", channelId: "thmanyah-1", confidence: "exact" },
      },
    ];
    const fresh = [
      {
        ...previous[0],
        channel: "ثمانية 3",
        broadcast: { provider: "thmanyah", channelId: "thmanyah-3", confidence: "exact" },
      },
    ];

    const [result] = preservePreviousExact(fresh, previous);
    expect(result.channel).toBe("ثمانية 3");
    expect(result.broadcast.channelId).toBe("thmanyah-3");
  });

  it("projects Saudi broadcasts into commentary hydration without touching European rows", () => {
    const previousCommentary = [
      {
        key: "arsenal~liverpool",
        home: "Arsenal",
        away: "Liverpool",
        channel: "beIN Sports 1",
        channelId: "bein-sports-1",
      },
      {
        key: "alhilal~alnassr",
        home: "Al Hilal",
        away: "Al Nassr",
        channel: "beIN Sports 1",
        channelId: "bein-sports-1",
      },
    ];
    const broadcasts = [
      {
        id: "espn-ksa.1-1",
        key: "alhilal~alnassr",
        home: "Al Hilal",
        away: "Al Nassr",
        kickoffUtc: "2026-09-05T18:00:00Z",
        channel: "ثمانية 1",
        broadcast: {
          provider: "thmanyah",
          channelId: "thmanyah-1",
          source: "almaghrebsport",
          confidence: "exact",
        },
        commentators: [],
      },
    ];

    const merged = mergeCommentaryIndex(previousCommentary, broadcasts);
    expect(merged.find((row) => row.key === "arsenal~liverpool")).toMatchObject({
      channel: "beIN Sports 1",
      channelId: "bein-sports-1",
    });
    const saudi = merged.find((row) => row.key === "alhilal~alnassr");
    expect(saudi).toMatchObject({
      channel: "ثمانية 1",
      broadcast: { channelId: "thmanyah-1" },
    });
    expect(saudi.channelId).toBeUndefined();
  });

  it("does not treat timestamps outside the broadcast rows as a content change", () => {
    const rows = [
      {
        id: "espn-ksa.1-1",
        key: "alhilal~alnassr",
        channel: "ثمانية",
        broadcast: { provider: "thmanyah", channelId: "thmanyah" },
      },
    ];
    expect(rowsChanged(rows, JSON.parse(JSON.stringify(rows)))).toBe(false);
  });
});
