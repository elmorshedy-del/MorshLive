import { describe, expect, it } from "vitest";
import { iptvLabRoute } from "../backend/routes/iptv-lab.js";

/**
 * The line runs on max_connections: 1, so anyone who can mint a playable URL
 * owns the account. These endpoints were open to any client anywhere — proven
 * by calling them from a bare container with no Origin and no Referer — which
 * is how a single scraper pulled 5.21GB in six hours while real viewers drained.
 */

const ctx = (path, headers = {}) => {
  const url = new URL(`https://korazero.com${path}`);
  return {
    request: new Request(url, { headers }),
    env: {},
    url,
    method: "GET",
  };
};

async function status(path, headers) {
  return (await iptvLabRoute.handle(ctx(path, headers))).status;
}

describe("iptv-lab same-origin gate", () => {
  it("refuses a playback-minting call with no Origin and no Referer", async () => {
    expect(await status("/api/iptv-lab/live?stream=2443")).toBe(403);
    expect(await status("/api/iptv-lab/channel?id=bein-sports-1")).toBe(403);
    // probe opens a real /live/ request, so it takes the slot by itself.
    expect(await status("/api/iptv-lab/probe?stream=2443")).toBe(403);
  });

  it("refuses a foreign Origin or Referer", async () => {
    expect(await status("/api/iptv-lab/live", { Origin: "https://evil.example" })).toBe(403);
    expect(await status("/api/iptv-lab/live", { Referer: "https://evil.example/x" })).toBe(403);
  });

  it("allows a same-origin page", async () => {
    // No IPTV_LAB_JSON in env, so these get past the gate and fail downstream
    // on the missing secret — 403 would mean the gate wrongly rejected them.
    expect(await status("/api/iptv-lab/live", { Origin: "https://korazero.com" })).not.toBe(403);
    expect(
      await status("/api/iptv-lab/channel?id=bein-sports-1", {
        Referer: "https://korazero.com/watch.html?match=1",
      }),
    ).not.toBe(403);
  });

  it("leaves metadata endpoints ungated", async () => {
    // Operator curls and diagnostics depend on these, and nothing here plays.
    expect(await status("/api/iptv-lab/status")).not.toBe(403);
    expect(await status("/api/iptv-lab/catalog")).not.toBe(403);
  });
});
