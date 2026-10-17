import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildBindings,
  mergeActiveBindings,
  mergeGeneratedPlans,
  mergeFixtureChannels,
  parseBeinChannel,
  parseFilGoalBroadcasts,
} = require("../scripts/v2-bein-bindings-lib.js");

const VEGA = {
  variant: "Vega",
  baseUrl: "https://v2-mist-production.up.railway.app/hls",
  channels: {
    "bein-sports-2": {
      playbackChannelId: "v2-bein-sports-2",
      streamId: "3644",
      name: "beIN Sports 2",
    },
    "bein-sports-6": {
      playbackChannelId: "v2-bein-sports-6",
      streamId: "3650",
      name: "beIN Sports 6",
    },
    "bein-xtra-2": {
      playbackChannelId: "v2-bein-xtra-2",
      streamId: "31153",
      name: "beIN Sports Xtra 2",
    },
  },
};

function matchBlock({ href, home, away, channel, time }) {
  return `
    <div class="cin_cntnr">
      <a href="${href}">
        <div class="c-i-next">
          <div class="f"><strong>${home}</strong></div>
          <div class="s"><strong>${away}</strong></div>
        </div>
        <div class="match-aux">
          <span>الملعب</span>
          <span>${channel}</span>
          <span>${time}</span>
        </div>
      </a>
    </div>
  `;
}

describe("V2 beIN qualifier bindings", () => {
  it("retains an exact two-team channel listing with a bounded kickoff discrepancy", () => {
    const fixture = {
      id: "barca",
      competition: "laliga",
      home: "Real Betis",
      away: "Barcelona",
      kickoffUtc: "2026-10-17T16:00Z",
    };
    const row = {
      competition: "laliga",
      homeAr: "ريال بيتيس",
      awayAr: "برشلونة",
      kickoffUtc: "2026-10-17T16:30Z",
      channelKey: "bein-sports-2",
      channelLabel: "beIN SPORTS 2 HD",
    };
    const bindings = buildBindings([fixture], [row], VEGA, Date.parse("2026-10-17T12:00Z"));
    expect(bindings).toMatchObject([
      {
        matchId: "barca",
        streamId: "3644",
        kickoffDifferenceMinutes: 30,
        broadcastKickoffUtc: row.kickoffUtc,
      },
    ]);
    const plans = mergeGeneratedPlans({ plans: [] }, bindings, VEGA, Date.parse("2026-10-17T12:00Z"));
    expect(plans.plans[0].kickoffUtc).toBe(row.kickoffUtc);
    expect(bindings[0].expiresAt).toBe("2026-10-17T19:15:00.000Z");
    expect(
      buildBindings(
        [fixture],
        [{ ...row, kickoffUtc: "2026-10-17T17:00Z" }],
        VEGA,
        Date.parse("2026-10-17T12:00Z"),
      )[0].expiresAt,
    ).toBe("2026-10-17T19:45:00.000Z");
    expect(
      buildBindings([fixture], [{ ...row, awayAr: "بارشلونا" }], VEGA, Date.parse("2026-10-17T12:00Z")),
    ).toEqual([]);
    expect(
      buildBindings(
        [fixture],
        [{ ...row, kickoffUtc: "2026-10-17T18:00Z" }],
        VEGA,
        Date.parse("2026-10-17T12:00Z"),
      ),
    ).toEqual([]);
    expect(
      buildBindings([fixture, { ...fixture, id: "ambiguous" }], [row], VEGA, Date.parse("2026-10-17T12:00Z")),
    ).toEqual([]);
  });

  it("uses the existing exact matcher for club broadcasts too", () => {
    const rows = parseFilGoalBroadcasts(
      matchBlock({
        href: "/matches/3/مباراة-مانشستر-سيتي-إبسويتش-تاون-في-الدوري-الإنجليزي-الممتاز",
        home: "مانشستر سيتي",
        away: "إيبسويتش تاون",
        channel: "beIN SPORTS 2 HD",
        time: "17-10-2026 - 17:00",
      }),
    );
    expect(rows).toHaveLength(1);
    const fixtures = [
      {
        id: "espn-eng.1-3",
        competition: "epl",
        home: "Manchester City",
        away: "Ipswich Town",
        kickoffUtc: "2026-10-17T14:00:00Z",
      },
    ];
    expect(buildBindings(fixtures, rows, VEGA, Date.parse("2026-10-17T10:00:00Z"))).toMatchObject([
      { matchId: "espn-eng.1-3", streamId: "3644" },
    ]);
  });

  it("rejects contradictory numbered channels for the same fixture", () => {
    const fixture = {
      id: "espn-uefa.nations-1",
      competition: "unl",
      home: "Italy",
      away: "Belgium",
      kickoffUtc: "2026-09-25T18:45:00Z",
    };
    const row = {
      competition: "unl",
      homeAr: "إيطاليا",
      awayAr: "بلجيكا",
      channelKey: "bein-sports-2",
      kickoffUtc: fixture.kickoffUtc,
    };
    expect(
      buildBindings(
        [fixture],
        [row, { ...row, channelKey: "bein-sports-6" }],
        VEGA,
        Date.parse("2026-09-25T12:00:00Z"),
      ),
    ).toEqual([]);
  });

  it("does not bind when just one of the two teams matches", () => {
    const fixture = {
      id: "espn-uefa.nations-1",
      competition: "unl",
      home: "Italy",
      away: "Belgium",
      kickoffUtc: "2026-09-25T18:45:00Z",
    };
    const row = {
      competition: "unl",
      homeAr: "إيطاليا",
      awayAr: "بلجيكا الجديدة",
      channelKey: "bein-sports-2",
      kickoffUtc: fixture.kickoffUtc,
    };
    expect(buildBindings([fixture], [row], VEGA, Date.parse("2026-09-25T12:00:00Z"))).toEqual([]);
  });

  it("hydrates only exact fixture ids while preserving highlights and manual channel pins", () => {
    const old = {
      id: "old",
      home: "Italy",
      away: "Belgium",
      channelId: "bein-sports-6",
      clips: ["goal"],
      highlights: { full: "replay" },
    };
    const fixture = { id: "new", home: "Italy", away: "Belgium", kickoffUtc: "2026-10-17T14:00Z" };
    const binding = {
      matchId: "new",
      broadcastChannelId: "bein-sports-2",
      channel: "beIN Sports 2",
      kickoffUtc: fixture.kickoffUtc,
      expiresAt: "2026-10-17T16:45Z",
    };
    const payload = { matches: [old], highlightsIndex: [{ key: "archive" }] };
    const merged = mergeFixtureChannels(payload, [binding], [fixture], {}, Date.parse("2026-10-17T12:00Z"));
    expect(merged.matches.find((m) => m.id === "old")).toEqual(old);
    expect(merged.matches.find((m) => m.id === "new")).toMatchObject({ channelId: "bein-sports-2" });
    expect(merged.highlightsIndex).toEqual(payload.highlightsIndex);
    expect(
      mergeFixtureChannels(
        payload,
        [binding],
        [fixture],
        { new: { channelId: "bein-sports-6" } },
        Date.parse("2026-10-17T12:00Z"),
      ),
    ).toEqual(payload);
    expect(mergeFixtureChannels(payload, [binding], [fixture], {}, Date.parse("2026-10-18T12:00Z"))).toEqual(
      payload,
    );
  });

  it("keeps an unassigned fixture waiting instead of falling through to an unrelated legacy channel", () => {
    const fixture = {
      id: "unassigned",
      home: "Real Betis",
      away: "Barcelona",
      kickoffUtc: "2026-10-17T16:00Z",
    };
    const catalog = mergeGeneratedPlans(
      { version: 1, plans: [] },
      [],
      VEGA,
      Date.parse("2026-10-17T12:00Z"),
      [fixture],
    );
    expect(catalog.plans).toMatchObject([
      {
        matchId: "unassigned",
        status: "pending",
        sources: [],
        policy: { allowLegacy: false, allowUnverifiedFallback: false },
      },
    ]);
    expect(catalog.plans[0].verifiedAt).toBeUndefined();
    expect(mergeGeneratedPlans(catalog, [], VEGA, Date.parse("2026-10-17T12:15Z"), [fixture])).toEqual(
      catalog,
    );
  });

  it("does not restore a rejected conflict or an operator override from the previous snapshot", () => {
    const previous = [
      { matchId: "conflict", expiresAt: "2026-10-17T20:00Z" },
      { matchId: "manual", expiresAt: "2026-10-17T20:00Z" },
    ];
    expect(
      mergeActiveBindings(
        previous,
        [],
        [{ id: "conflict" }, { id: "manual" }],
        Date.parse("2026-10-17T12:00Z"),
        new Set(["conflict", "manual"]),
      ),
    ).toEqual([]);
  });

  it("clears rejected generator-owned card channels without discarding clips", () => {
    const payload = {
      matches: [
        {
          id: "m1",
          channelId: "bein-sports-2",
          channel: "beIN Sports 2",
          channelSource: "v2-bein-qualifiers",
          clips: ["goal"],
        },
      ],
    };
    const merged = mergeFixtureChannels(
      payload,
      [],
      [{ id: "m1" }],
      {},
      Date.parse("2026-10-17T12:00Z"),
      new Set(["m1"]),
    );
    expect(merged.matches[0].channelId).toBeUndefined();
    expect(merged.matches[0].channel).toBeUndefined();
    expect(merged.matches[0].clips).toEqual(["goal"]);
  });

  it("ends a binding before the next fixture on the same channel enters its TV window", () => {
    const fixtures = [
      { id: "first", competition: "unl", home: "Italy", away: "Belgium", kickoffUtc: "2026-10-17T14:00Z" },
      { id: "next", competition: "unl", home: "Turkey", away: "France", kickoffUtc: "2026-10-17T16:30Z" },
    ];
    const rows = [
      {
        competition: "unl",
        homeAr: "إيطاليا",
        awayAr: "بلجيكا",
        channelKey: "bein-sports-2",
        kickoffUtc: fixtures[0].kickoffUtc,
      },
      {
        competition: "unl",
        homeAr: "تركيا",
        awayAr: "فرنسا",
        channelKey: "bein-sports-2",
        kickoffUtc: fixtures[1].kickoffUtc,
      },
    ];
    const bindings = buildBindings(fixtures, rows, VEGA, Date.parse("2026-10-17T12:00Z"));
    expect(bindings[0].expiresAt).toBe("2026-10-17T16:00:00.000Z");
    const retained = { ...bindings[0], expiresAt: "2026-10-17T16:45:00.000Z" };
    expect(
      mergeActiveBindings([retained], [bindings[1]], fixtures, Date.parse("2026-10-17T12:00Z"))[0].expiresAt,
    ).toBe("2026-10-17T16:00:00.000Z");
    const simultaneous = [{ ...fixtures[1], kickoffUtc: fixtures[0].kickoffUtc }, fixtures[0]];
    const simultaneousRows = [{ ...rows[1], kickoffUtc: rows[0].kickoffUtc }, rows[0]];
    expect(buildBindings(simultaneous, simultaneousRows, VEGA, Date.parse("2026-10-17T12:00Z"))).toEqual([]);
  });

  it("applies a new manual override over a previously generated card channel", () => {
    const payload = {
      matches: [
        {
          id: "m1",
          channelId: "bein-sports-2",
          channel: "beIN Sports 2",
          channelSource: "v2-bein-qualifiers",
          clips: ["goal"],
        },
      ],
    };
    const result = mergeFixtureChannels(payload, [], [{ id: "m1" }], {
      m1: { channelId: "bein-sports-6", channel: "beIN Sports 6" },
    });
    expect(result.matches[0]).toMatchObject({
      channelId: "bein-sports-6",
      channel: "beIN Sports 6",
      clips: ["goal"],
    });
    expect(
      mergeFixtureChannels(result, [], [{ id: "m1" }], {
        m1: { channelId: "bein-sports-1", channel: "beIN Sports 1" },
      }).matches[0].channelId,
    ).toBe("bein-sports-1");
  });

  it("accepts Arabic numbered/Xtra beIN and rejects EN/generic labels", () => {
    expect(parseBeinChannel("beIN SPORTS 6 HD")?.key).toBe("bein-sports-6");
    expect(parseBeinChannel("beIN Sports XTRA 2")?.key).toBe("bein-xtra-2");
    expect(parseBeinChannel("beIN Sports EN 1 HD")).toBeNull();
    expect(parseBeinChannel("شبكة بي إن سبورتس (يُعلن الرقم لاحقاً)")).toBeNull();
  });

  it("parses FilGoal qualifier rows without guessing an unpublished channel", () => {
    const html =
      matchBlock({
        href: "/matches/1/مباراة-إيطاليا-بلجيكا-في-دوري-الأمم-الأوروبية-المستوى-الأول",
        home: "إيطاليا",
        away: "بلجيكا",
        channel: "beIN SPORTS 6 HD",
        time: "25-09-2026 - 21:45",
      }) +
      matchBlock({
        href: "/matches/2/مباراة-ألمانيا-اليونان-في-دوري-الأمم-الأوروبية-المستوى-الأول",
        home: "ألمانيا",
        away: "اليونان",
        channel: "شبكة بي إن سبورتس",
        time: "27-09-2026 - 21:45",
      });
    const rows = parseFilGoalBroadcasts(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      competition: "unl",
      homeAr: "إيطاليا",
      awayAr: "بلجيكا",
      channelKey: "bein-sports-6",
      kickoffUtc: "2026-09-25T18:45:00.000Z",
    });
  });

  it("joins an exact ESPN fixture to its Vega stream", () => {
    const fixtures = [
      {
        id: "espn-uefa.nations-1",
        competition: "unl",
        home: "Italy",
        away: "Belgium",
        kickoffUtc: "2026-09-25T18:45:00Z",
      },
      {
        id: "espn-uefa.nations-2",
        competition: "unl",
        home: "Turkey",
        away: "France",
        kickoffUtc: "2026-09-25T18:45:00Z",
      },
    ];
    const rows = [
      {
        competition: "unl",
        homeAr: "إيطاليا",
        awayAr: "بلجيكا",
        channelKey: "bein-sports-6",
        channelLabel: "beIN SPORTS 6 HD",
        kickoffUtc: "2026-09-25T18:45:00Z",
        sourceHref: "/matches/1",
      },
    ];
    const bindings = buildBindings(fixtures, rows, VEGA, Date.parse("2026-09-25T12:00:00Z"));
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      matchId: "espn-uefa.nations-1",
      streamId: "3650",
      playbackChannelId: "v2-bein-sports-6",
    });
  });

  it("keeps a still-active exact Arabic binding when the scrape returns no usable row", () => {
    const fixtures = [
      {
        id: "espn-uefa.nations-1",
        competition: "unl",
        home: "Sweden",
        away: "Romania",
        kickoffUtc: "2026-09-25T18:45:00Z",
      },
    ];
    const previous = [
      {
        matchId: "espn-uefa.nations-1",
        home: "Sweden",
        away: "Romania",
        kickoffUtc: "2026-09-25T18:45:00Z",
        channel: "beIN Sports 9",
        streamId: "3647",
        expiresAt: "2026-09-25T21:30:00Z",
      },
    ];
    const merged = mergeActiveBindings(previous, [], fixtures, Date.parse("2026-09-25T14:00:00Z"));
    expect(merged).toEqual(previous);
  });

  it("keeps unexpired bindings when the ESPN fixture refresh itself is unavailable", () => {
    const previous = [
      {
        matchId: "espn-uefa.nations-1",
        kickoffUtc: "2026-09-25T18:45:00Z",
        streamId: "3647",
        expiresAt: "2026-09-25T21:30:00Z",
      },
    ];
    expect(mergeActiveBindings(previous, [], [], Date.parse("2026-09-25T14:00:00Z"))).toEqual(previous);
  });

  it("lets a fresh exact Arabic assignment replace the retained one", () => {
    const fixtures = [{ id: "m1" }];
    const previous = [
      {
        matchId: "m1",
        kickoffUtc: "2026-09-25T18:45:00Z",
        streamId: "3647",
        expiresAt: "2026-09-25T21:30:00Z",
      },
    ];
    const fresh = [
      {
        matchId: "m1",
        kickoffUtc: "2026-09-25T18:45:00Z",
        streamId: "3650",
        expiresAt: "2026-09-25T21:30:00Z",
      },
    ];
    expect(mergeActiveBindings(previous, fresh, fixtures, Date.parse("2026-09-25T14:00:00Z"))).toEqual(fresh);
  });

  it("replaces only generated plans and preserves manual matchday plans", () => {
    const catalog = {
      version: 1,
      plans: [
        { matchId: "manual", status: "verified", sources: [] },
        { matchId: "old-auto", generatedBy: "v2-bein-qualifiers", sources: [] },
      ],
    };
    const bindings = [
      {
        matchId: "espn-uefa.nations-1",
        home: "Italy",
        away: "Belgium",
        kickoffUtc: "2026-09-25T18:45:00Z",
        channel: "beIN Sports 6",
        streamId: "3650",
        observedLabel: "beIN SPORTS 6 HD",
        expiresAt: "2026-09-25T21:30:00Z",
      },
    ];
    const merged = mergeGeneratedPlans(catalog, bindings, VEGA, Date.parse("2026-09-25T12:00:00Z"));
    expect(merged.plans.some((plan) => plan.matchId === "manual")).toBe(true);
    expect(merged.plans.some((plan) => plan.matchId === "old-auto")).toBe(false);
    const auto = merged.plans.find((plan) => plan.matchId === "espn-uefa.nations-1");
    expect(auto?.sources?.[0]?.url).toBe(
      "https://v2-mist-production.up.railway.app/hls/iptv-3650/index.m3u8",
    );
    expect(auto?.policy?.allowLegacy).toBe(false);
  });
});
