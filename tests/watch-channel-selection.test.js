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

  it("binds a match that carries only broadcast.channelId", () => {
    // broadcast-registry.js leaves playbackChannelId null for Thmanyah, so a
    // Saudi row reaches the browser with a label and broadcast.channelId but no
    // channelId. Reading only channelId left the match unbound and dropped it
    // onto channels[0] — beIN Sports 1, offering beIN 1/2.
    const matches = [
      {
        id: "espn-ksa.1-3",
        status: "live",
        channel: "ثمانية 2",
        broadcast: { provider: "thmanyah", channelId: "thmanyah-2", confidence: "exact" },
      },
    ];
    const selection = window.resolveWatchSelection(
      matches,
      CHANNELS,
      new URLSearchParams("match=espn-ksa.1-3"),
    );

    expect(selection.channel.id).toBe("thmanyah-2");
    expect(selection.channel.group).toBe("ثمانية");
  });

  it("counts a broadcast-only match as occupying its channel", () => {
    const matches = [
      { id: "ksa-generic", channelId: "thmanyah", kickoffUtc: "2026-09-08T15:55Z" },
      {
        id: "ksa-a",
        kickoffUtc: "2026-09-08T15:30Z",
        broadcast: { provider: "thmanyah", channelId: "thmanyah-1" },
      },
    ];
    const selection = window.resolveWatchSelection(
      matches,
      CHANNELS,
      new URLSearchParams("match=ksa-generic"),
    );

    expect(selection.channel.id).toBe("thmanyah-2");
  });

  describe("the قناة أخرى؟ row can actually change the channel", () => {
    // The row keeps the match id in the URL and sets ch. A match id normally
    // outranks ch, which silently swallowed the click once Saudi fixtures were
    // bound to a channel at all.
    const saudi = {
      id: "espn-ksa.1-9",
      status: "live",
      broadcast: { provider: "thmanyah", channelId: "thmanyah-2" },
    };

    it("honours a hand-picked channel on the same network", () => {
      const selection = window.resolveWatchSelection(
        [saudi],
        CHANNELS,
        new URLSearchParams("match=espn-ksa.1-9&ch=thmanyah-3"),
      );
      expect(selection.channel.id).toBe("thmanyah-3");
    });

    it("lets an unnumbered fixture be moved off its guessed channel", () => {
      const unnumbered = { id: "ksa-generic", channelId: "thmanyah", kickoffUtc: "2026-09-08T15:55Z" };
      const selection = window.resolveWatchSelection(
        [unnumbered],
        CHANNELS,
        new URLSearchParams("match=ksa-generic&ch=thmanyah-3"),
      );
      expect(selection.channel.id).toBe("thmanyah-3");
    });

    it("still ignores a stale ch from another network", () => {
      const selection = window.resolveWatchSelection(
        [saudi],
        CHANNELS,
        new URLSearchParams("match=espn-ksa.1-9&ch=bein-sports-2"),
      );
      expect(selection.channel.id).toBe("thmanyah-2");
    });

    it("still ignores an unknown ch", () => {
      const selection = window.resolveWatchSelection(
        [saudi],
        CHANNELS,
        new URLSearchParams("match=espn-ksa.1-9&ch=not-a-channel"),
      );
      expect(selection.channel.id).toBe("thmanyah-2");
    });
  });

  // Mirrors watch.js switchableChannels(): the row is the bound channel's group
  // siblings, and it hides itself when that leaves fewer than two.
  const switchRow = (selection) => CHANNELS.filter((channel) => channel.group === selection.channel.group);

  describe("an unnumbered Saudi fixture avoids channels already carrying a match", () => {
    const unnumbered = { id: "ksa-generic", channelId: "thmanyah", kickoffUtc: "2026-09-08T15:55Z" };

    it("skips a channel taken by a match kicking off in the same window", () => {
      const matches = [
        unnumbered,
        // 25 minutes earlier, well inside the 105-minute clash window.
        { id: "ksa-a", channelId: "thmanyah-1", kickoffUtc: "2026-09-08T15:30Z" },
      ];
      const selection = window.resolveWatchSelection(
        matches,
        CHANNELS,
        new URLSearchParams("match=ksa-generic"),
      );

      expect(selection.channel.id).toBe("thmanyah-2");
      const offered = switchRow(selection).map((channel) => channel.id);
      expect(offered).toEqual(["thmanyah-2", "thmanyah-3"]);
      expect(offered).not.toContain("thmanyah-1");
    });

    it("leaves a single free channel, which watch.js then renders as no choice", () => {
      const matches = [
        unnumbered,
        { id: "ksa-a", channelId: "thmanyah-1", kickoffUtc: "2026-09-08T15:30Z" },
        { id: "ksa-b", channelId: "thmanyah-2", kickoffUtc: "2026-09-08T16:00Z" },
      ];
      const selection = window.resolveWatchSelection(
        matches,
        CHANNELS,
        new URLSearchParams("match=ksa-generic"),
      );

      expect(selection.channel.id).toBe("thmanyah-3");
      expect(switchRow(selection)).toHaveLength(1);
    });

    it("ignores a match far enough away to not clash", () => {
      const matches = [unnumbered, { id: "ksa-a", channelId: "thmanyah-1", kickoffUtc: "2026-09-08T19:00Z" }];
      const selection = window.resolveWatchSelection(
        matches,
        CHANNELS,
        new URLSearchParams("match=ksa-generic"),
      );

      expect(selection.channel.id).toBe("thmanyah-1");
      expect(switchRow(selection)).toHaveLength(3);
    });

    it("keeps the first channel when every sibling is spoken for", () => {
      const matches = [
        unnumbered,
        { id: "ksa-a", channelId: "thmanyah-1", kickoffUtc: "2026-09-08T15:30Z" },
        { id: "ksa-b", channelId: "thmanyah-2", kickoffUtc: "2026-09-08T16:00Z" },
        { id: "ksa-c", channelId: "thmanyah-3", kickoffUtc: "2026-09-08T15:40Z" },
      ];
      const selection = window.resolveWatchSelection(
        matches,
        CHANNELS,
        new URLSearchParams("match=ksa-generic"),
      );

      expect(selection.channel.id).toBe("thmanyah-1");
      expect(selection.channel.group).toBe("ثمانية");
    });

    it("does not let one page's narrowing leak into the next call", () => {
      const clashing = [
        unnumbered,
        { id: "ksa-a", channelId: "thmanyah-1", kickoffUtc: "2026-09-08T15:30Z" },
      ];
      window.resolveWatchSelection(clashing, CHANNELS, new URLSearchParams("match=ksa-generic"));

      const selection = window.resolveWatchSelection(
        [unnumbered],
        CHANNELS,
        new URLSearchParams("match=ksa-generic"),
      );
      expect(selection.channel.id).toBe("thmanyah-1");
      expect(switchRow(selection)).toHaveLength(3);
    });
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
