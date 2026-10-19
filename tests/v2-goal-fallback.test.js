import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  collectGoalFixtures,
  collectGoalTvChannels,
  findGoalFixture,
  nextData,
  pickGoalBeinChannel,
  sameTeam,
} = require("../scripts/v2-goal-broadcasts-lib.js");
const { buildExactFixtureBindings } = require("../scripts/v2-bein-bindings-lib.js");

const VEGA = {
  baseUrl: "https://v2.example/hls",
  channels: {
    "bein-sports-6": {
      playbackChannelId: "v2-bein-sports-6",
      streamId: "3650",
      name: "beIN Sports 6",
    },
    "bein-sports-9": {
      playbackChannelId: "v2-bein-sports-9",
      streamId: "3647",
      name: "beIN Sports 9",
    },
  },
};

function nextHtml(payload) {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></html>`;
}

describe("V2 Goal broadcaster fallback", () => {
  it("normalizes the real Roma and Porto naming differences without fuzzy guessing", () => {
    expect(sameTeam("AS Roma", "Roma")).toBe(true);
    expect(sameTeam("FC Porto", "Porto")).toBe(true);
    expect(sameTeam("PSV Eindhoven", "PSV Eindhoven")).toBe(true);
    expect(sameTeam("Manchester United", "Manchester City")).toBe(false);
  });

  it("extracts Goal fixtures and requires a unique exact teams + kickoff match", () => {
    const payload = {
      pageProps: {
        blocks: [
          {
            link: { pageType: "MATCH", id: "roma-slovan" },
            startDate: "2026-10-20T19:00:00Z",
            teamA: { name: "Roma" },
            teamB: { name: "Slovan Bratislava" },
          },
        ],
      },
    };
    const rows = collectGoalFixtures(nextData(nextHtml(payload)));
    expect(rows).toHaveLength(1);
    expect(
      findGoalFixture(
        {
          id: "espn-roma",
          home: "AS Roma",
          away: "Slovan Bratislava",
          kickoffUtc: "2026-10-20T19:00:00Z",
        },
        rows,
      )?.id,
    ).toBe("roma-slovan");

    expect(
      findGoalFixture(
        {
          home: "AS Roma",
          away: "Slovan Bratislava",
          kickoffUtc: "2026-10-20T19:00:00Z",
        },
        [...rows, { ...rows[0], id: "duplicate" }],
      ),
    ).toBeNull();
  });

  it("rejects youth/reserve lookalikes even when parent-club names and kickoff are close", () => {
    const fixture = {
      home: "AS Roma",
      away: "Slovan Bratislava",
      kickoffUtc: "2026-10-20T19:00:00Z",
    };
    expect(
      findGoalFixture(fixture, [
        {
          id: "youth",
          start: "2026-10-20T19:00:00Z",
          home: "Roma U19",
          away: "Slovan Bratislava U19",
        },
      ]),
    ).toBeNull();
  });

  it("selects only a V2-routable Arabic beIN listing and supports beIN 6/9", () => {
    const detail = {
      pageProps: {
        match: {
          tvChannels: [{ name: "beIN SPORTS EN 1" }, { name: "beIN Sports FR 2" }, { name: "beIN SPORTS 6" }],
        },
      },
    };
    const names = collectGoalTvChannels(nextData(nextHtml(detail)));
    expect(pickGoalBeinChannel(names, VEGA)).toMatchObject({
      key: "bein-sports-6",
      label: "beIN SPORTS 6",
    });
    expect(pickGoalBeinChannel(["beIN SPORTS 9"], VEGA)?.key).toBe("bein-sports-9");
    expect(pickGoalBeinChannel(["beIN SPORTS 5"], VEGA)).toBeNull();
  });

  it("creates exact V2 bindings for Roma-Slovan and Porto-PSV after Goal resolves the channels", () => {
    const fixtures = [
      {
        id: "espn-uefa.champions-401915402",
        competition: "ucl",
        home: "AS Roma",
        away: "Slovan Bratislava",
        kickoffUtc: "2026-10-20T19:00:00Z",
      },
      {
        id: "espn-uefa.champions-401915398",
        competition: "ucl",
        home: "FC Porto",
        away: "PSV Eindhoven",
        kickoffUtc: "2026-10-20T19:00:00Z",
      },
    ];
    const rows = [
      {
        matchId: fixtures[0].id,
        kickoffUtc: fixtures[0].kickoffUtc,
        channelKey: "bein-sports-6",
        channelLabel: "beIN SPORTS 6",
        sourceHref: "goal:roma-slovan",
      },
      {
        matchId: fixtures[1].id,
        kickoffUtc: fixtures[1].kickoffUtc,
        channelKey: "bein-sports-9",
        channelLabel: "beIN SPORTS 9",
        sourceHref: "goal:porto-psv",
      },
    ];
    expect(buildExactFixtureBindings(fixtures, rows, VEGA, Date.parse("2026-10-19T12:00:00Z"))).toMatchObject(
      [
        {
          matchId: fixtures[0].id,
          broadcastChannelId: "bein-sports-6",
          playbackChannelId: "v2-bein-sports-6",
          streamId: "3650",
        },
        {
          matchId: fixtures[1].id,
          broadcastChannelId: "bein-sports-9",
          playbackChannelId: "v2-bein-sports-9",
          streamId: "3647",
        },
      ],
    );
  });

  it("refuses contradictory channels for the same exact fixture id", () => {
    const fixture = {
      id: "m1",
      competition: "ucl",
      home: "AS Roma",
      away: "Slovan Bratislava",
      kickoffUtc: "2026-10-20T19:00:00Z",
    };
    const excluded = new Set();
    const bindings = buildExactFixtureBindings(
      [fixture],
      [
        {
          matchId: "m1",
          kickoffUtc: fixture.kickoffUtc,
          channelKey: "bein-sports-6",
          channelLabel: "beIN SPORTS 6",
        },
        {
          matchId: "m1",
          kickoffUtc: fixture.kickoffUtc,
          channelKey: "bein-sports-9",
          channelLabel: "beIN SPORTS 9",
        },
      ],
      VEGA,
      Date.parse("2026-10-19T12:00:00Z"),
      excluded,
    );
    expect(bindings).toEqual([]);
    expect(excluded.has("m1")).toBe(true);
  });
});
