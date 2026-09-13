import fs from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * CLAUDE-STAMP 2026-09-13 — PREMIUM-991-PATH-RETIRED-1
 *
 * The `?source=iptv-premium` route mounted PREMIUM_CHANNELS, which pins stream
 * ids 991 and 992. lib/xtream-channel-map.js documents those ids as absent from
 * the current catalogue — the portal was rebuilt underneath them, which is the
 * whole reason that resolver describes channels instead of pinning ids. A
 * pinned id does not fail loudly: it 404s, or it now belongs to a different
 * channel and quietly plays the wrong match.
 *
 * It was also a second playback path that bypassed the working resolver, and on
 * a max_connections: 1 line a second path is a drain, not a cosmetic extra.
 *
 * It had two entry points and removing one left the other live: the card toggle
 * in assets/js/app.js, and the watch-page source tabs in assets/js/watch.js.
 * A tree-wide rollback restored both once already. These assertions fail in CI
 * rather than letting either come back quietly a third time.
 */

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("retired premium (991/992) playback path", () => {
  it("does not render the premium source tabs on the watch page", () => {
    const watch = read("assets/js/watch.js");

    expect(
      watch,
      "watch.js must not build the gold premium source tab",
    ).not.toContain("watch-source-toggle__opt--premium");
    expect(
      watch,
      "watch.js must not link into the retired ?source=iptv-premium route",
    ).not.toContain('premiumUrl.searchParams.set("source", "iptv-premium")');
  });

  it("never activates premium mode, so a cached or bookmarked link falls through", () => {
    const watch = read("assets/js/watch.js");

    // Reading the param back would re-arm the dead path for anyone holding an
    // old link, which is how it kept resurfacing after the card toggle went.
    expect(
      watch,
      "premiumRequested must stay hard-false, not read from the URL",
    ).not.toContain('const premiumRequested = params.get("source") === "iptv-premium"');
    expect(watch).toContain("const premiumRequested = false;");
  });

  it("keeps the card renderer off the premium route too", () => {
    const app = read("assets/js/app.js");

    expect(app).not.toContain("watch-source-toggle__opt--premium");
    expect(app).not.toContain('url.searchParams.set("source", "iptv-premium")');
  });

  it("leaves the working xtream route untouched", () => {
    const watch = read("assets/js/watch.js");
    const router = read("assets/js/iptv-auto.js");

    // Retiring the premium path must not take the live path with it.
    expect(watch).toContain('const xtreamMode = params.get("source") === "xtream"');
    expect(router).toContain('url.searchParams.set("source", "xtream")');
  });
});
