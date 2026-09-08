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

/**
 * watch.js resolves twice. It calls resolveWatchSelection once with its own
 * empty MATCHES, then reassigns MATCHES from the fixtures feed and calls it
 * again. Only the second pass has an explicitMatch, and it is the pass that
 * decides what the viewer ends up on — so a rule that only holds for the first
 * pass is not a rule at all. Every case here supplies the fixture.
 */
describe("once the fixtures have loaded", () => {
  const euro = [{ id: EURO, channelId: "bein-sports-2", status: "live" }];
  const saudi = [{ id: SAUDI, channelId: "thmanyah-2", status: "live" }];
  const pick = (matches, query) =>
    window.resolveWatchSelection(matches, CHANNELS, new URLSearchParams(query)).channel.id;

  it("uses the fixture's own channel when nothing was picked", () => {
    expect(pick(euro, `match=${EURO}`)).toBe("bein-sports-2");
    expect(pick(saudi, `match=${SAUDI}`)).toBe("thmanyah-2");
  });

  it("keeps a channel the viewer picked by hand", () => {
    // The regression this guards: the second pass overwrote the click with the
    // fixture's own channel, so the row appeared to do nothing.
    expect(pick(euro, `match=${EURO}&ch=bein-sports-1`)).toBe("bein-sports-1");
    expect(pick(euro, `match=${EURO}&ch=bein-sports-4`)).toBe("bein-sports-4");
    expect(pick(saudi, `match=${SAUDI}&ch=thmanyah-3`)).toBe("thmanyah-3");
  });

  it("still refuses a channel from the other network", () => {
    expect(pick(euro, `match=${EURO}&ch=thmanyah-2`)).toBe("bein-sports-2");
    expect(pick(saudi, `match=${SAUDI}&ch=bein-sports-2`)).toBe("thmanyah-2");
  });

  it("ignores a channel that does not exist", () => {
    expect(pick(euro, `match=${EURO}&ch=bein-sports-9`)).toBe("bein-sports-2");
    expect(pick(euro, `match=${EURO}&ch=not-a-channel`)).toBe("bein-sports-2");
  });

  it("carries the pick into the embed", () => {
    const selection = window.resolveWatchSelection(
      euro,
      CHANNELS,
      new URLSearchParams(`match=${EURO}&ch=bein-sports-3`),
    );
    expect(selection.channel.embed.channelId).toBe("bein-sports-3");
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

/**
 * Resolving the channel correctly is only half of it — the player has to mount
 * the channel the resolver chose. mountLabChannel() used to read
 * `match.channelId` first, which put the fixture's own channel back after
 * resolveWatchSelection had honoured the viewer's pick: the قناة أخرى؟ row moved
 * its highlight and the stream never changed. Saudi cards looked fine only
 * because their fixtures carry no channelId, so the fallback was already the
 * resolver's answer.
 *
 * watch.js is stream-locked and its IIFE cannot be imported, so this reads the
 * source. That is the point — the invariant is that playback takes its channel
 * from one place.
 */
describe("the player mounts the channel the resolver picked", () => {
  const watchSource = readFileSync(require.resolve("../assets/js/watch.js"), "utf8");
  const mountBody = watchSource.slice(
    watchSource.indexOf("async function mountLabChannel()"),
    watchSource.indexOf("async function loadPlayer()"),
  );

  it("reads the resolved channel", () => {
    expect(mountBody).toContain("const channelId = channel.id;");
  });

  it("does not take the channel from the fixture instead", () => {
    expect(mountBody).not.toMatch(/match\s*&&\s*match\.channelId/);
  });
});
