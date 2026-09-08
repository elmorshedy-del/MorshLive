import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const DATA_JS = require.resolve("../assets/js/data.js");

/**
 * data.js is a browser script that publishes onto `window`, so evaluate it in a
 * sandbox with just enough of a DOM to run. Only the pure selection helpers are
 * exercised here — nothing touches playback.
 */
function loadSiteData() {
  const window = {};
  const context = {
    window,
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
    location: { origin: "https://korazero.com", search: "" },
    navigator: { language: "ar" },
    URL,
    URLSearchParams,
    fetch: async () => ({ ok: false }),
    console,
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  createContext(context);
  runInContext(readFileSync(DATA_JS, "utf8"), context);
  return window;
}

describe("watch page channel selection", () => {
  const window = loadSiteData();
  const { CHANNELS } = window.SITE_DATA;

  it("keeps beIN Sports 1 first so it stays the default fallback", () => {
    expect(CHANNELS[0].id).toBe("bein-sports-1");
  });

  it("knows the numbered Thmanyah channels the Saudi pipeline emits", () => {
    // scripts/broadcast-registry.js emits these ids for Saudi Pro League rows.
    for (const id of ["thmanyah-1", "thmanyah-2", "thmanyah-3"]) {
      expect(CHANNELS.find((channel) => channel.id === id)).toBeTruthy();
    }
  });

  it("resolves a Saudi match to its Thmanyah channel instead of beIN Sports 1", () => {
    // resolveWatchSelection falls back to channels[0] when an id is unknown, so
    // a missing Thmanyah definition silently relabels every Saudi match as beIN
    // Sports 1 and offers beIN 1/2 as its alternatives.
    const matches = [{ id: "espn-ksa.1-1", channelId: "thmanyah-2", status: "pre" }];
    const selection = window.resolveWatchSelection(
      matches,
      CHANNELS,
      new URLSearchParams("match=espn-ksa.1-1"),
    );

    expect(selection.channel.id).toBe("thmanyah-2");
    expect(selection.channel.group).toBe("ثمانية");
    expect(selection.channel.embed.channelId).toBe("thmanyah-2");
  });

  it("offers the other Thmanyah channels, not beIN, as Saudi alternatives", () => {
    // Mirrors watch.js switchableChannels(): siblings sharing the bound
    // channel's group are what the "قناة أخرى؟" row offers.
    const bound = CHANNELS.find((channel) => channel.id === "thmanyah-2");
    const siblings = CHANNELS.filter((channel) => channel.group === bound.group);

    expect(siblings.map((channel) => channel.id)).toEqual(["thmanyah-1", "thmanyah-2", "thmanyah-3"]);
    expect(siblings.some((channel) => channel.id.startsWith("bein"))).toBe(false);
  });

  it("sends an unnumbered Saudi row to ثمانية 1 rather than beIN Sports 1", () => {
    // LiveFootballTV publishes a numbered channel only a couple of days out, so
    // a fixture can legitimately carry the network-level id "thmanyah". There is
    // no such channel to play; the viewer picks the right number themselves from
    // the alternatives, which must be the ثمانية ones.
    const matches = [{ id: "espn-ksa.1-2", channelId: "thmanyah", status: "pre" }];
    const selection = window.resolveWatchSelection(
      matches,
      CHANNELS,
      new URLSearchParams("match=espn-ksa.1-2"),
    );

    expect(selection.channel.id).toBe("thmanyah-1");
    expect(selection.channel.group).toBe("ثمانية");

    const siblings = CHANNELS.filter((channel) => channel.group === selection.channel.group);
    expect(siblings.map((channel) => channel.id)).toEqual(["thmanyah-1", "thmanyah-2", "thmanyah-3"]);
  });

  it("leaves an id that names no known network alone", () => {
    const matches = [{ id: "x", channelId: "not-a-network", status: "pre" }];
    const selection = window.resolveWatchSelection(matches, CHANNELS, new URLSearchParams("match=x"));
    expect(selection.channel.id).toBe("bein-sports-1");
  });

  it("still groups a beIN match with its own network", () => {
    const matches = [{ id: "espn-eng.1-1", channelId: "bein-sports-2", status: "pre" }];
    const selection = window.resolveWatchSelection(
      matches,
      CHANNELS,
      new URLSearchParams("match=espn-eng.1-1"),
    );

    expect(selection.channel.id).toBe("bein-sports-2");
    const siblings = CHANNELS.filter((channel) => channel.group === selection.channel.group);
    expect(siblings.map((channel) => channel.id)).toEqual(["bein-sports-1", "bein-sports-2"]);
  });
});
