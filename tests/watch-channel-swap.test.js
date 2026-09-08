import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

/**
 * data.js is a browser script that publishes onto `window`, so evaluate it in a
 * sandbox with just enough of a DOM to run. Only the pure selection helper is
 * exercised — nothing here touches playback.
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
  runInContext(readFileSync(require.resolve("../assets/js/data.js"), "utf8"), context);
  return window;
}

const window = loadSiteData();
const { CHANNELS, MATCHES } = window.SITE_DATA;

// watch.js calls resolveWatchSelection with data.js's own empty MATCHES array,
// so `ch` and the match id are the only inputs that decide a channel. Every case
// below goes through that same shape rather than a fixture list the page cannot
// actually supply.
const select = (query) => window.resolveWatchSelection(MATCHES || [], CHANNELS, new URLSearchParams(query));

// Mirrors watch.js switchableChannels(): the row is the bound channel's group
// siblings, and it hides itself when fewer than two remain.
const switchRow = (selection) =>
  CHANNELS.filter((c) => c.group === selection.channel.group).map((c) => c.name);

const SAUDI = "espn-ksa.1-401900363";
const EURO = "espn-uefa.champions-401915452";

describe("Saudi fixtures are swapped onto Thmanyah", () => {
  it("takes a Thmanyah channel instead of inheriting the beIN default", () => {
    const selection = select(`match=${SAUDI}`);
    expect(selection.channel.id).toBe("thmanyah-1");
    expect(switchRow(selection)).toEqual(["ثمانية 1", "ثمانية 2", "ثمانية 3"]);
  });

  it("carries the swap into the embed, not just the row", () => {
    // This id is what reaches /api/iptv-lab/channel, where a wrong network would
    // quietly resolve a real stream from the wrong competition.
    expect(select(`match=${SAUDI}`).channel.embed.channelId).toBe("thmanyah-1");
  });

  it("honours a hand-picked Thmanyah channel", () => {
    expect(select(`match=${SAUDI}&ch=thmanyah-3`).channel.id).toBe("thmanyah-3");
  });

  it("refuses a beIN channel on a Saudi fixture", () => {
    expect(select(`match=${SAUDI}&ch=bein-sports-2`).channel.id).toBe("thmanyah-1");
  });
});

describe("European fixtures keep beIN", () => {
  it("binds to beIN and offers beIN alternatives", () => {
    const selection = select(`match=${EURO}`);
    expect(selection.channel.id).toBe("bein-sports-1");
    expect(switchRow(selection)).toEqual([
      "beIN Sports 1",
      "beIN Sports 2",
      "beIN Sports 3",
      "beIN Sports 4",
    ]);
  });

  it("still switches between beIN channels by hand", () => {
    expect(select(`match=${EURO}&ch=bein-sports-2`).channel.id).toBe("bein-sports-2");
  });

  it("refuses a Thmanyah channel left over from a Saudi card", () => {
    // The regression this guards: a stale `ch` once repainted a Champions League
    // page with ثمانية 1/2/3 and bound its embed to a Saudi stream.
    const selection = select(`match=${EURO}&ch=thmanyah-2`);
    expect(selection.channel.id).toBe("bein-sports-1");
    expect(selection.channel.embed.channelId).toBe("bein-sports-1");
    expect(switchRow(selection)).not.toContain("ثمانية 2");
  });

  it("keeps beIN MAX reachable", () => {
    expect(select(`match=${EURO}&ch=bein-max-3`).channel.id).toBe("bein-max-3");
  });

  it("offers all four beIN Sports channels", () => {
    // A Champions League night runs four simultaneous ties across beIN 1-4.
    expect(switchRow(select(`match=${EURO}`))).toEqual([
      "beIN Sports 1",
      "beIN Sports 2",
      "beIN Sports 3",
      "beIN Sports 4",
    ]);
  });

  it("binds a fixture carried on beIN Sports 3 or 4", () => {
    for (const id of ["bein-sports-3", "bein-sports-4"]) {
      const selection = select(`match=${EURO}&ch=${id}`);
      expect(selection.channel.id).toBe(id);
      expect(selection.channel.embed.channelId).toBe(id);
    }
  });

  it("still keeps beIN 3 and 4 away from a Saudi fixture", () => {
    for (const id of ["bein-sports-3", "bein-sports-4"]) {
      expect(select(`match=${SAUDI}&ch=${id}`).channel.id).toBe("thmanyah-1");
    }
  });
});

describe("with no fixture named", () => {
  it("defaults to beIN Sports 1", () => {
    expect(select("").channel.id).toBe("bein-sports-1");
  });

  it("does not let a bare ch reach Thmanyah", () => {
    expect(select("ch=thmanyah-2").channel.id).toBe("bein-sports-1");
  });

  it("leaves the existing beIN behaviour alone", () => {
    expect(select("ch=bein-sports-2").channel.id).toBe("bein-sports-2");
    expect(select("ch=live").channel.id).toBe("bein-sports-1");
  });
});
