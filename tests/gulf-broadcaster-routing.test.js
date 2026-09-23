import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const browserResolver = require("../assets/js/iptv-channel-resolver.js");
const { resolveBroadcastChannel } = require("../scripts/broadcast-registry.js");

describe("Gulf Cup broadcaster routing", () => {
  it("resolves Al Kass 1 to the best live-catalogue variant", () => {
    const catalog = [
      { streamId: "210259", name: "BeIN Alkass 1 SD" },
      { streamId: "89778", name: "BeIN Alkass 1 HD" },
      { streamId: "210263", name: "BeIN Alkass 1 4K" },
    ];
    expect(browserResolver.resolveChannel("alkass-1", catalog)).toMatchObject({
      streamId: "89778",
    });
  });

  it("resolves the Oman Sports singleton", () => {
    expect(
      browserResolver.resolveChannel("oman-sports", [{ streamId: "4650", name: "Oman Sport [OM]" }]),
    ).toMatchObject({ streamId: "4650" });
  });

  it("resolves numbered Shasha Sport channels", () => {
    expect(
      browserResolver.resolveChannel("shasha-sport-2", [
        { streamId: "244602", name: "SHASHA SPORT 1 HD" },
        { streamId: "244603", name: "SHASHA SPORT 2 HD" },
        { streamId: "244604", name: "SHASHA SPORT 3 HD" },
      ]),
    ).toMatchObject({ streamId: "244603" });
  });

  it("uses the same canonical keys for broadcaster labels and catalogue names", () => {
    expect(browserResolver.canonicalKey("BeIN Alkass 1 HD")).toBe("alkass-1");
    expect(browserResolver.canonicalKey("Oman Sport [OM]")).toBe("oman-sports");
    expect(browserResolver.canonicalKey("SHASHA SPORT 3 HD")).toBe("shasha-sport-3");
  });

  it("normalizes broadcaster labels into playable ids", () => {
    expect(resolveBroadcastChannel("الكأس 1")).toMatchObject({
      provider: "alkass",
      playbackChannelId: "alkass-1",
    });
    expect(resolveBroadcastChannel("Oman Sports")).toMatchObject({
      provider: "oman-sports",
      playbackChannelId: "oman-sports",
    });
    expect(resolveBroadcastChannel("شاشا 2")).toMatchObject({
      provider: "shasha",
      playbackChannelId: "shasha-sport-2",
    });
  });

  it("pins Saudi Arabia vs Kuwait to Al Kass 1 by exact ESPN id", () => {
    const overrides = JSON.parse(readFileSync("assets/data/manual-channel-overrides.json", "utf8"));
    expect(overrides["espn-global.gulf_cup-401922490"]).toMatchObject({
      channel: "Al Kass 1",
      channelId: "alkass-1",
      broadcast: {
        provider: "alkass",
        channelId: "alkass-1",
        confidence: "exact",
      },
    });
  });

  it("enables the Gulf Cup in the deterministic IPTV router", () => {
    const auto = readFileSync("assets/js/iptv-auto.js", "utf8");
    expect(auto).toContain('"gulfcup"');
    expect(auto).toContain('"global.gulf_cup"');
  });

  it("exposes the Gulf channels to the site channel registry", () => {
    const data = readFileSync("assets/js/data.js", "utf8");
    for (const id of ["alkass-1", "oman-sports", "shasha-sport-1"]) {
      expect(data).toContain(`id: "${id}"`);
    }
  });
});
