import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
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

  it("re-pins an already-pinned row without reporting a change", () => {
    const previous = [
      {
        id: "espn-ksa.1-1",
        key: "alhilal~alnassr",
        home: "Al Hilal",
        away: "Al Nassr",
        kickoffUtc: "2026-09-05T18:00:00Z",
        channel: "\u062b\u0645\u0627\u0646\u064a\u0629 2",
        broadcast: {
          provider: "thmanyah",
          channelId: "thmanyah-2",
          source: "livefootballtv",
          confidence: "exact",
        },
      },
    ];
    const generic = {
      ...previous[0],
      channel: "\u062b\u0645\u0627\u0646\u064a\u0629",
      broadcast: {
        provider: "thmanyah",
        channelId: "thmanyah",
        source: "spl-rights-holder",
        confidence: "network",
      },
    };

    // Run the refresher's merge repeatedly against its own output, exactly as
    // the scheduled workflow does. The pin must converge instead of growing a
    // new `:pinned` suffix — an endless diff would commit and redeploy forever.
    const first = preservePreviousExact([{ ...generic }], previous);
    expect(first[0].broadcast.source).toBe("livefootballtv:pinned");

    const second = preservePreviousExact([{ ...generic }], first);
    expect(second[0].broadcast.source).toBe("livefootballtv:pinned");
    expect(rowsChanged(first, second)).toBe(false);

    const third = preservePreviousExact([{ ...generic }], second);
    expect(third[0].broadcast.source).toBe("livefootballtv:pinned");
    expect(rowsChanged(second, third)).toBe(false);
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
