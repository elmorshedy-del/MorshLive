import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { applySaudiTvGuide, parseSaudiTvGuide } = require("../scripts/saudi-tv-guide-lib.js");
const channelResolver = require("../assets/js/iptv-channel-resolver.js");
const tvWindow = require("../assets/js/iptv-window.js");
const epgMatcher = require("../assets/js/iptv-epg-match-core.js");
const legacyNormalizer = require("../assets/js/iptv-legacy-toggle-normalizer.js");

function at(kickoff, minutes) {
  return Date.parse(kickoff) + minutes * 60 * 1000;
}

function thmanyahGuideCell() {
  return `
    <td class="canales">
      <div itemscope itemtype="https://schema.org/Event">
        <meta itemprop="name" content="Al Shabab FC - Al Hilal" />
        <meta itemprop="startDate" content="2026-09-16T18:00:00" />
      </div>
      <ul class="listaCanales">
        <li title="Thmanyah Channels"><a>Thmanyah Channels</a></li>
        <li title="Thmanyah 1 HD"><a>Thmanyah 1 HD</a></li>
      </ul>
    </td>`;
}

describe("deterministic IPTV rollout contract", () => {
  it("joins Saudi fixture -> exact Thmanyah assignment -> catalog stream -> T-30 TV eligibility", () => {
    const kickoffUtc = "2026-09-16T18:00:00Z";
    const match = {
      id: "espn-ksa.1-401900001",
      competition: "spl",
      leagueSlug: "ksa.1",
      home: "Al Shabab",
      away: "Al Hilal",
      kickoffUtc,
      status: "scheduled",
      channel: "ثمانية",
      broadcast: { provider: "thmanyah", channelId: "thmanyah", confidence: "network" },
    };
    const commentaryIndex = [];
    const rows = parseSaudiTvGuide(thmanyahGuideCell());

    expect(rows).toHaveLength(1);
    expect(applySaudiTvGuide([match], commentaryIndex, rows)).toBe(1);
    expect(match.broadcast).toMatchObject({
      channelId: "thmanyah-1",
      source: "livefootballtv",
      confidence: "exact",
    });

    const catalog = [
      { portalId: "lab", streamId: "8101", name: "ثمانية 1 HD", categoryName: "Arabic Sports" },
    ];
    const selected = channelResolver.resolveChannel(match, catalog);
    expect(selected).toMatchObject({
      portalId: "lab",
      streamId: "8101",
      resolver: { channelId: "thmanyah-1", method: "broadcaster" },
    });

    expect(tvWindow.isEligible(match, at(kickoffUtc, -31))).toBe(false);
    expect(tvWindow.cardActionKey(match, at(kickoffUtc, -31))).toBe("card.matchCentre");
    expect(tvWindow.isEligible(match, at(kickoffUtc, -30))).toBe(true);
    expect(tvWindow.cardActionKey(match, at(kickoffUtc, -29))).toBe("card.watch");

    match.status = "live";
    expect(tvWindow.cardActionKey(match, at(kickoffUtc, 10))).toBe("card.watchNow");
    match.status = "ended";
    expect(tvWindow.phase(match, at(kickoffUtc, 150))).toBe("postgame");
    expect(tvWindow.isEligible(match, at(kickoffUtc, 150))).toBe(true);
    expect(tvWindow.isEligible(match, at(kickoffUtc, 166))).toBe(false);
  });

  it("keeps the existing European broadcaster path deterministic", () => {
    const match = {
      id: "espn-eng.1-1",
      competition: "epl",
      leagueSlug: "eng.1",
      home: "Arsenal",
      away: "Liverpool",
      kickoffUtc: "2026-09-20T15:30:00Z",
      status: "scheduled",
      channel: "beIN Sports 1",
      channelId: "bein-sports-1",
    };
    const selected = channelResolver.resolveChannel(match, [
      { portalId: "lab", streamId: "9001", name: "beIN Sports 1 FHD", categoryName: "BEIN SPORTS" },
    ]);

    expect(selected).toMatchObject({
      streamId: "9001",
      resolver: { channelId: "bein-sports-1", method: "broadcaster" },
    });
    expect(tvWindow.cardActionKey(match, at(match.kickoffUtc, -90))).toBe("card.matchCentre");
    expect(tvWindow.cardActionKey(match, at(match.kickoffUtc, -20))).toBe("card.watch");
  });

  it("uses provider EPG only as a unique fail-closed fallback", () => {
    const kickoffUtc = "2026-09-20T15:30:00Z";
    const match = {
      id: "espn-eng.1-2",
      home: "Arsenal",
      away: "Liverpool",
      kickoffUtc,
      status: "scheduled",
    };
    const start = Date.parse(kickoffUtc) / 1000 - 20 * 60;
    const stop = Date.parse(kickoffUtc) / 1000 + 130 * 60;
    const hit = {
      logicalKey: "bein-sports-1",
      title: "Arsenal vs Liverpool",
      startTimestamp: start,
      stopTimestamp: stop,
      representativeStreamId: "9001",
      streamIds: ["9001"],
      channelName: "beIN Sports 1",
    };

    expect(epgMatcher.resolveProgramMatch(match, [hit])).toMatchObject({
      program: { logicalKey: "bein-sports-1" },
    });
    expect(
      epgMatcher.resolveProgramMatch(match, [
        hit,
        { ...hit, logicalKey: "bein-sports-2", representativeStreamId: "9002", streamIds: ["9002"] },
      ]),
    ).toBeNull();
  });

  it("normalizes the retired Euro premium route before deterministic auto-binding", () => {
    expect(
      legacyNormalizer.isLegacyPremiumHref(
        "watch.html?ch=bein-sports-1&match=espn-eng.1-1&source=iptv-premium",
      ),
    ).toBe(true);
    expect(
      legacyNormalizer.isLegacyPremiumHref(
        "watch.html?ch=bein-sports-1&match=espn-eng.1-1&source=xtream&stream=9001",
      ),
    ).toBe(false);

    const fakeWindow = {
      KZIptvWindow: { phase: () => "details" },
      I18N: { t: (key) => ({ "card.matchCentre": "تفاصيل المباراة" })[key] || key },
    };
    expect(legacyNormalizer.labelFor({}, fakeWindow)).toBe("تفاصيل المباراة");
  });

  it("boots the puzzle pieces in dependency order and routes resolved TV through Xtream", () => {
    const bootstrap = fs.readFileSync(new URL("../assets/js/i18n.js", import.meta.url), "utf8");
    const router = fs.readFileSync(new URL("../assets/js/iptv-auto.js", import.meta.url), "utf8");
    const order = [
      "iptv-channel-resolver.js",
      "iptv-window.js",
      "iptv-epg-match-core.js",
      "iptv-legacy-toggle-normalizer.js",
      "iptv-auto.js",
      "iptv-stage-copy.js",
      "iptv-premium-card-click.js",
    ].map((name) => bootstrap.indexOf(name));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(router).toContain('url.searchParams.set("source", "xtream")');
    expect(router).toContain('url.searchParams.set("stream", String(selected.streamId))');
    expect(router).toContain('"epl", "laliga", "spl", "ucl"');
  });
});
