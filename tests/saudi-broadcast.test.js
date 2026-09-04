const { describe, expect, it } = require("vitest");
const {
  isSaudiProLeagueMatch,
  resolveBroadcastChannel,
} = require("../scripts/broadcast-registry");
const { ensureSaudiBroadcastFallback } = require("../scripts/commentators-lib");

describe("Saudi broadcast registry", () => {
  it("normalizes official Thmanyah channel names including Arabic digits", () => {
    expect(resolveBroadcastChannel("ثمانية.١")).toMatchObject({
      channel: "ثمانية 1",
      provider: "thmanyah",
      broadcastChannelId: "thmanyah-1",
      playbackChannelId: null,
      confidence: "exact",
    });
    expect(resolveBroadcastChannel("Thmanyah 2 HD")).toMatchObject({
      channel: "ثمانية 2",
      broadcastChannelId: "thmanyah-2",
    });
    expect(resolveBroadcastChannel("ثمانية 3")).toMatchObject({
      channel: "ثمانية 3",
      broadcastChannelId: "thmanyah-3",
    });
  });

  it("keeps existing beIN playback routing intact", () => {
    expect(resolveBroadcastChannel("بي إن سبورت ماكس ٣")).toMatchObject({
      channel: "beIN MAX 3",
      broadcastChannelId: "bein-max-3",
      playbackChannelId: "bein-max-3",
    });
    expect(resolveBroadcastChannel("beIN Sports 2")).toMatchObject({
      channel: "beIN Sports 2",
      playbackChannelId: "bein-sports-2",
    });
  });

  it("identifies only Saudi Pro League fixtures for the rights-holder fallback", () => {
    expect(isSaudiProLeagueMatch({ competition: "spl" })).toBe(true);
    expect(isSaudiProLeagueMatch({ leagueSlug: "ksa.1" })).toBe(true);
    expect(isSaudiProLeagueMatch({ id: "espn-ksa.1-123" })).toBe(true);
    expect(isSaudiProLeagueMatch({ competition: "ucl", id: "espn-uefa.champions-123" })).toBe(false);
  });
});

describe("Saudi pre-match hydration", () => {
  it("adds the verified Thmanyah network before an exact numbered channel is published", () => {
    const matches = [
      {
        id: "espn-ksa.1-123",
        competition: "spl",
        leagueSlug: "ksa.1",
        home: "Al Hilal",
        away: "Al Nassr",
        channelId: "bein-sports-1",
      },
    ];
    const commentaryIndex = [];

    const hydrated = ensureSaudiBroadcastFallback(matches, commentaryIndex);

    expect(hydrated).toBe(1);
    expect(matches[0]).toMatchObject({
      channel: "ثمانية",
      channelId: "bein-sports-1",
      broadcast: {
        provider: "thmanyah",
        channelId: "thmanyah",
        source: "spl-rights-holder",
        confidence: "network",
      },
    });
    expect(commentaryIndex[0]).toMatchObject({
      channel: "ثمانية",
      broadcast: {
        provider: "thmanyah",
        channelId: "thmanyah",
      },
    });
    expect(commentaryIndex[0].channelId).toBeUndefined();
  });

  it("preserves an exact Thmanyah channel assignment from the Arabic source", () => {
    const matches = [
      {
        id: "espn-ksa.1-456",
        competition: "spl",
        home: "Al Ittihad",
        away: "Al Fateh",
        channel: "ثمانية 1",
        broadcast: {
          provider: "thmanyah",
          channelId: "thmanyah-1",
          source: "almaghrebsport",
          confidence: "exact",
        },
      },
    ];
    const commentaryIndex = [
      {
        key: "alfateh~alittihad",
        home: "Al Ittihad",
        away: "Al Fateh",
        commentators: [{ name: "جعفر الصليح", channel: "ثمانية 1" }],
        channel: "ثمانية 1",
        broadcast: matches[0].broadcast,
      },
    ];

    const hydrated = ensureSaudiBroadcastFallback(matches, commentaryIndex);

    expect(hydrated).toBe(0);
    expect(matches[0].channel).toBe("ثمانية 1");
    expect(matches[0].broadcast.channelId).toBe("thmanyah-1");
  });
});
