import { describe, expect, it } from "vitest";
import { resolveWatchArchiveRedirect } from "../lib/watch-archive-redirect.js";

const archive = [
  { id: "espn-fifa.world-760504", key: "brazil~norway", home: "Brazil", away: "Norway", status: "ended" },
];

describe("watch-archive-redirect", () => {
  it("redirects legacy hubs to tournament archive", () => {
    expect(resolveWatchArchiveRedirect("/live", new URLSearchParams(), archive, []).url).toBe(
      "/tournament.html",
    );
    expect(resolveWatchArchiveRedirect("/vip/bein-sports-1", new URLSearchParams(), archive, []).url).toBe(
      "/tournament.html",
    );
    expect(resolveWatchArchiveRedirect("/watch-embed.html", new URLSearchParams(), archive, []).url).toBe(
      "/tournament.html",
    );
  });

  it("redirects archived match watch URLs to tournament match deep link", () => {
    const params = new URLSearchParams("ch=bein-max-1&match=espn-fifa.world-760504");
    const hit = resolveWatchArchiveRedirect("/watch.html", params, archive, []);
    expect(hit.url).toBe("/tournament.html?match=brazil~norway");
    expect(hit.permanent).toBe(true);
  });

  it("redirects legacy channel pretty URLs to tournament", () => {
    expect(resolveWatchArchiveRedirect("/watch/bein-max-1", new URLSearchParams(), archive, []).url).toBe(
      "/tournament.html",
    );
  });

  it("redirects legacy beIN channel watch URLs to tournament", () => {
    const params = new URLSearchParams("ch=bein-max-1");
    expect(resolveWatchArchiveRedirect("/watch.html", params, archive, []).url).toBe("/tournament.html");
  });

  it("keeps live hub without a match param for today's fixtures", () => {
    const params = new URLSearchParams("ch=live");
    expect(resolveWatchArchiveRedirect("/watch.html", params, archive, [])).toBeNull();
  });

  it("keeps live today fixtures on watch page", () => {
    const today = [{ id: "espn-123", key: "a~b", status: "live" }];
    const params = new URLSearchParams("match=espn-123");
    expect(resolveWatchArchiveRedirect("/watch.html", params, archive, today)).toBeNull();
  });
});
