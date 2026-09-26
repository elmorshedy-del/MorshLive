import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchBackendRoutes } from "../backend/router.js";
import { streamPlanRoute } from "../backend/routes/stream-plan.js";

function assetEnv(files) {
  return {
    ASSETS: {
      async fetch(url) {
        const path = String(url).replace("https://korazero.com", "");
        const body = files[path];
        if (!body) return new Response("missing", { status: 404 });
        return new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stream plan route", () => {
  it("rejects requests without a match identity", async () => {
    const res = await dispatchBackendRoutes(
      [streamPlanRoute],
      new Request("https://korazero.com/api/stream-plan"),
      assetEnv({}),
      {},
    );
    expect(res?.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Match id or team pair required" });
  });

  it("returns a catalog operator plan instead of the generic embed", async () => {
    const env = assetEnv({
      "/assets/data/today.json": {
        matches: [
          {
            id: "espn-eng.1-401111111",
            home: "Liverpool",
            away: "Arsenal",
            channelId: "bein-sports-1",
            status: "live",
          },
        ],
      },
      "/assets/data/stream-plans.json": {
        version: 1,
        plans: [
          {
            matchId: "espn-eng.1-401111111",
            contentKey: "bein-sports-1",
            policy: { allowLegacy: false },
            sources: [
              {
                id: "primary",
                role: "primary",
                kind: "iframe",
                url: "https://example.test/embed/bein1",
                contentKey: "bein-sports-1",
                status: "operator",
              },
            ],
          },
        ],
      },
    });

    const res = await dispatchBackendRoutes(
      [streamPlanRoute],
      new Request("https://korazero.com/api/stream-plan?match=espn-eng.1-401111111"),
      env,
      {},
    );

    expect(res?.status).toBe(200);
    expect(res.headers.get("x-kz-proxy")).toBe("stream-plan");
    const body = await res.json();
    expect(body).toMatchObject({
      status: "operator",
      matchId: "espn-eng.1-401111111",
      selected: { url: "https://example.test/embed/bein1" },
    });
  });

  it("holds two live catalog plans that share one content key", async () => {
    const env = assetEnv({
      "/assets/data/today.json": {
        matches: [
          {
            id: "espn-eng.1-1",
            home: "Liverpool",
            away: "Arsenal",
            channelId: "bein-sports-1",
            status: "live",
          },
          {
            id: "espn-esp.1-2",
            home: "Real Madrid",
            away: "Barcelona",
            channelId: "bein-sports-2",
            status: "live",
          },
        ],
      },
      "/assets/data/stream-plans.json": {
        version: 1,
        plans: [
          {
            matchId: "espn-eng.1-1",
            contentKey: "bein-sports-1",
            policy: { allowLegacy: false },
            sources: [
              {
                id: "primary",
                role: "primary",
                url: "https://example.test/a",
                contentKey: "bein-sports-1",
                status: "verified",
              },
            ],
          },
          {
            matchId: "espn-esp.1-2",
            contentKey: "bein-sports-1",
            policy: { allowLegacy: false },
            sources: [
              {
                id: "primary",
                role: "primary",
                url: "https://example.test/b",
                contentKey: "bein-sports-1",
                status: "verified",
              },
            ],
          },
        ],
      },
    });

    const res = await dispatchBackendRoutes(
      [streamPlanRoute],
      new Request("https://korazero.com/api/stream-plan?match=espn-eng.1-1"),
      env,
      {},
    );
    expect(res?.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "conflict",
      selected: null,
      reason: "shared-content-key",
    });
  });

  it("promotes only the pending V2 source whose Mist channel is active", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        expect(String(url)).toBe("https://v2-control-production.up.railway.app/api/active");
        return new Response(
          JSON.stringify({
            active: { channelId: "iptv-89778", streamId: "89778", inputs: 1 },
            conflict: false,
            live: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const env = assetEnv({
      "/assets/data/today.json": {
        matches: [{ id: "iraq", home: "Kuwait", away: "Iraq", status: "upcoming" }],
      },
      "/assets/data/stream-plans.json": {
        version: 1,
        plans: [
          {
            matchId: "iraq",
            contentKey: "match:iraq",
            policy: { allowLegacy: false },
            sources: [
              {
                id: "v2-alkass1",
                role: "alternate",
                kind: "hls",
                url: "https://v2-mist-production.up.railway.app/hls/iptv-89778/index.m3u8",
                contentKey: "match:iraq",
                status: "pending",
              },
            ],
          },
        ],
      },
    });

    const res = await dispatchBackendRoutes(
      [streamPlanRoute],
      new Request("https://korazero.com/api/stream-plan?match=iraq"),
      env,
      {},
    );
    expect(res?.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "operator",
      selected: {
        id: "v2-alkass1",
        status: "operator",
        playbackUrl: "https://v2-mist-production.up.railway.app/hls/iptv-89778/index.m3u8",
      },
      reason: "remote-active:iptv-89778",
      v2Remote: { active: "iptv-89778" },
    });
  });

  it("fails closed when a statically operator V2 source is not the active remote channel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              active: { channelId: "iptv-89778", streamId: "89778", inputs: 1 },
              conflict: false,
              live: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const env = assetEnv({
      "/assets/data/today.json": {
        matches: [{ id: "england", home: "England", away: "Spain", status: "upcoming" }],
      },
      "/assets/data/stream-plans.json": {
        version: 1,
        plans: [
          {
            matchId: "england",
            contentKey: "match:england",
            policy: { allowLegacy: false },
            sources: [
              {
                id: "v2-bein-3645",
                role: "primary",
                kind: "hls",
                url: "https://v2-mist-production.up.railway.app/hls/iptv-3645/index.m3u8",
                contentKey: "match:england",
                status: "operator",
              },
            ],
          },
        ],
      },
    });

    const res = await dispatchBackendRoutes(
      [streamPlanRoute],
      new Request("https://korazero.com/api/stream-plan?match=england"),
      env,
      {},
    );
    expect(await res.json()).toMatchObject({
      status: "waiting",
      selected: null,
      reason: "v2-remote-other:iptv-89778",
      v2Remote: { active: "iptv-89778" },
    });
  });
});
