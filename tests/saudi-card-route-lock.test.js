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
    const app = fs.readFileSync(new URL("../assets/js/app.js", import.meta.url), "utf8");

    expect(bootstrap).toContain("if (isWatchPage)");
    expect(bootstrap).not.toContain("iptv-premium-card-click.js");
    expect(app).not.toContain('url.searchParams.set("source", "iptv-premium")');
    expect(app).not.toContain("watch-source-toggle__opt--premium");
    expect(app).toContain("if (isSaudiProLeagueMatch(m))");
    expect(app).toContain('return `<a class="watch-link" href="');
  });
});
