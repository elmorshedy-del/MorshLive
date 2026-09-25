import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildBindings,
  mergeActiveBindings,
  mergeGeneratedPlans,
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
