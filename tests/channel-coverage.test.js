import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

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
const { CHANNELS } = window.SITE_DATA;
const known = new Set(CHANNELS.map((c) => c.id));

/**
 * A channel the pipeline can name but CHANNEL_DEFS does not model does not fail
 * loudly — it fails as the wrong match. resolveWatchSelection falls back to
 * channels[0] for an id it does not recognise, so a card correctly hydrated for
 * beIN 5 played beIN 1, and an explicit ?ch= for it was refused too. Nothing
 * anywhere reported a problem.
 *
 * That is what happened the first Saturday goal.com covered: it put Crystal
 * Palace v Ipswich on beIN 5 and two LaLiga fixtures on beIN 9, and the site
 * modelled only 1-4. These tests are the canary — if a source names a channel
 * the site cannot route, CI says so instead of a viewer finding out at kickoff.
 */
describe("every channel a source can name is one the site can route", () => {
  it("covers the beIN Sports range beIN MENA actually broadcasts on", () => {
    // beIN MENA runs 1-9 and a full league weekend uses the upper numbers.
    for (let n = 1; n <= 9; n += 1) {
      expect(known.has(`bein-sports-${n}`), `bein-sports-${n} is not in CHANNEL_DEFS`).toBe(true);
    }
  });

  it("routes every channel in the generated overrides file", () => {
    // A live canary: this file is rewritten by each goal.com harvest, so a new
    // channel appearing upstream fails here rather than silently downstream.
    const overrides = JSON.parse(
      readFileSync(require.resolve("../assets/data/broadcast-overrides.json"), "utf8"),
    );
    const seen = new Set();
    for (const row of Object.values(overrides.rows || {})) {
      if (row?.channelId) seen.add(row.channelId);
    }
    for (const id of seen) {
      expect(known.has(id), `broadcast-overrides.json names ${id}, which CHANNEL_DEFS does not model`).toBe(
        true,
      );
    }
  });

  it("routes every channel in the hand-made overrides file", () => {
    const manual = JSON.parse(
      readFileSync(require.resolve("../assets/data/manual-channel-overrides.json"), "utf8"),
    );
    for (const [id, row] of Object.entries(manual)) {
      if (!row?.channelId) continue;
      expect(
        known.has(row.channelId),
        `${id} is pinned to ${row.channelId}, which CHANNEL_DEFS does not model`,
      ).toBe(true);
    }
  });

  it("routes every channel today.json currently binds", () => {
    const today = JSON.parse(readFileSync(require.resolve("../assets/data/today.json"), "utf8"));
    const seen = new Set();
    for (const row of today.commentaryIndex || []) if (row?.channelId) seen.add(row.channelId);
    for (const row of today.matches || []) if (row?.channelId) seen.add(row.channelId);
    for (const id of seen) {
      expect(known.has(id), `today.json binds ${id}, which CHANNEL_DEFS does not model`).toBe(true);
    }
  });

  it("resolves an upper-range channel to itself rather than to beIN 1", () => {
    // The failure this suite exists for, stated directly.
    const fixtures = [
      {
        id: "espn-eng.1-1",
        home: "Crystal Palace",
        away: "Ipswich Town",
        channelId: "bein-sports-5",
        status: "upcoming",
      },
    ];
    const resolve = (query) =>
      window.resolveWatchSelection(fixtures, CHANNELS, new URLSearchParams(query)).channel.id;
    expect(resolve("match=espn-eng.1-1")).toBe("bein-sports-5");
    expect(resolve("match=espn-eng.1-1&ch=bein-sports-5")).toBe("bein-sports-5");
  });

  it("still refuses a beIN pick on a Saudi card", () => {
    // Widening the beIN range must not widen the crossover guard.
    const fixtures = [{ id: "espn-ksa.1-1", home: "Al Hilal", away: "Al Nassr", status: "upcoming" }];
    const picked = window.resolveWatchSelection(
      fixtures,
      CHANNELS,
      new URLSearchParams("match=espn-ksa.1-1&ch=bein-sports-9"),
    ).channel.id;
    expect(picked).toMatch(/^thmanyah-/);
  });
});
