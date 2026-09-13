import fs from "node:fs";
import { describe, expect, it } from "vitest";

// CHATGPT-STAMP 2026-09-07 — SAUDI-CARD-NORMAL-WATCH-LOCK-1
// Regression guard for the pre-rollback normal card route. This test protects
// public card/bootstrap behavior only; IPTV Lab and playback files are outside
// this change and remain protected by Stream Lock.
describe("Saudi card normal-watch route", () => {
  it("keeps fixture-specific Saudi broadcaster metadata ahead of generic schedule fallback", () => {
    const router = fs.readFileSync(new URL("../assets/js/iptv-auto.js", import.meta.url), "utf8");

    expect(router).toContain(
      "const broadcast = override.broadcast || row.broadcast || match.broadcast || null;",
    );
    expect(router).toContain(
      'const channelId = override.channelId || broadcast?.channelId || row.channelId || match.channelId || "";',
    );
    expect(router).not.toContain(
      'const channelId = override.channelId || match.channelId || row.channelId || broadcast?.channelId || "";',
    );
  });

  it("keeps homepage cards on normal watch links and auto-routing on the watch page only", () => {
    const bootstrap = fs.readFileSync(new URL("../assets/js/i18n.js", import.meta.url), "utf8");
    const router = fs.readFileSync(new URL("../assets/js/iptv-auto.js", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../assets/js/app.js", import.meta.url), "utf8");
    const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const stamp = bootstrap.match(/const stamp = "([^"]+)";/)?.[1];

    expect(bootstrap).toContain("if (isWatchPage)");
    expect(bootstrap).not.toContain("iptv-premium-card-click.js");
    expect(router).toContain('const isWatchPage = cleanPath === "/watch.html" || cleanPath === "/watch";');
    expect(router).toContain('if (!isWatchPage || pageParams.get("source") === "xtream") return;');
    expect(app).not.toContain('url.searchParams.set("source", "iptv-premium")');
    expect(app).not.toContain("watch-source-toggle__opt--premium");
    expect(app).toContain("if (isSaudiProLeagueMatch(m))");
    expect(app).toContain('return `<a class="watch-link" href="');

    // A whole-tree rollback previously restored old HTML cache keys even after
    // the source files had been repaired, so browsers could keep executing the
    // retired homepage router. Keep the entry-point generation tied to the
    // bootstrap generation instead of pinning another historical key.
    expect(stamp).toBeTruthy();
    expect(index).toContain(`assets/js/i18n.js?v=${stamp}`);
    expect(index).toContain(`assets/js/app.js?v=${stamp}`);
    expect(index).not.toContain("assets/js/i18n.js?v=20260904bindingfix1");
    expect(index).not.toContain("assets/js/app.js?v=20260830soon");
  });
});
