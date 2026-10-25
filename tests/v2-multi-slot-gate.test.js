import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchBackendRoutes } from "../backend/router.js";
import { streamPlanRoute } from "../backend/routes/stream-plan.js";

afterEach(() => vi.unstubAllGlobals());

async function resolve(body, channel = "iptv-3645", timing = {}) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body)));
  const files = {
    "/assets/data/today.json": { matches: [{ id: "multi", home: "Home", away: "Away" }] },
    "/assets/data/stream-plans.json": {
      version: 1,
      updatedAt: "2099-01-01T00:00Z",
      plans: [
        {
          matchId: "multi",
          policy: { allowLegacy: false },
          ...timing,
          sources: [
            {
              id: "v2",
              kind: "hls",
              role: "primary",
              status: "pending",
              url: `https://mist-v2.korazero.com/hls/${channel}/index.m3u8`,
            },
          ],
        },
      ],
    },
  };
  const env = {
    ASSETS: { fetch: async (url) => new Response(JSON.stringify(files[new URL(url).pathname])) },
  };
  const response = await dispatchBackendRoutes(
    [streamPlanRoute],
    new Request("https://korazero.com/api/stream-plan?match=multi"),
    env,
    {},
  );
  return response.json();
}

const live = [{ channelId: "iptv-3645" }, { channelId: "iptv-3653" }];
describe("V2 capacity gate", () => {
  it.each(["iptv-3645", "iptv-3653"])("allows each healthy active channel: %s", async (channel) => {
    expect(await resolve({ capacity: 2, live }, channel)).toMatchObject({
      status: "operator",
      reason: `remote-active:${channel}`,
      v2Remote: { active: channel, activeIds: ["iptv-3645", "iptv-3653"] },
    });
  });
  it("holds the third channel and reports all active ids", async () => {
    expect(await resolve({ capacity: 2, live }, "iptv-3650")).toMatchObject({
      selected: null,
      reason: "v2-remote-other:iptv-3645,iptv-3653",
    });
  });
  it.each([undefined, 1, 0, 5, "2", 1.5])("fails closed above valid capacity %s", async (capacity) => {
    expect(await resolve({ capacity, live })).toMatchObject({ selected: null, reason: "v2-remote-off" });
  });
  it("fails closed for an explicit conflict", async () => {
    expect(await resolve({ capacity: 2, live, conflict: true })).toMatchObject({
      selected: null,
      v2Remote: { active: null, activeIds: [] },
    });
  });
  it("accepts legacy active with an empty live list", async () => {
    expect(await resolve({ active: live[0], live: [] })).toMatchObject({
      status: "operator",
      v2Remote: { activeIds: ["iptv-3645"] },
    });
  });
  it("ignores junk types and de-duplicates normalized string ids", async () => {
    const channelIds = [3645, null, {}, "IPTV-3645", "iptv-3645 ", "iptv-3645", "iptv-3645"];
    expect(await resolve({ live: channelIds.map((channelId) => ({ channelId })) })).toMatchObject({
      status: "operator",
      v2Remote: { activeIds: ["iptv-3645"] },
    });
  });
  it("normalizes legacy uppercase ids", async () => {
    expect(await resolve({ active: { channelId: "IPTV-3645" } })).toMatchObject({ status: "operator" });
  });
  it("does not trust stale active when a nonempty live list has no valid ids", async () => {
    expect(await resolve({ active: { channelId: "iptv-3645" }, live: [{}] })).toMatchObject({
      selected: null,
    });
  });
  it("preserves the match window even with two active channels", async () => {
    expect(
      await resolve({ capacity: 2, live }, "iptv-3645", {
        kickoffUtc: new Date(Date.now() + 7200000).toISOString(),
      }),
    ).toMatchObject({ selected: null, reason: "v2-before-match-window" });
  });
});
