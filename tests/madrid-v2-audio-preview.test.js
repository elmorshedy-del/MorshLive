import { afterEach, describe, expect, it, vi } from "vitest";
import { getStreamPlan } from "../backend/services/stream-plan.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function preview({
  matchId = "espn-uefa.champions-401915383",
  at = "2026-11-04T15:00:00Z",
  active = "iptv-3644",
  channel = "iptv-3644",
  conflict = false,
} = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(at));
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          active: active ? { channelId: active } : null,
          conflict,
          live: [],
        }),
      ),
  );
  const files = {
    "/assets/data/today.json": {
      matches: [{ id: matchId, home: "AEK Athens", away: "Real Madrid", status: "upcoming" }],
    },
    "/assets/data/stream-plans.json": {
      version: 1,
      updatedAt: "2099-01-01T00:00Z",
      plans: [
        {
          matchId,
          kickoffUtc: "2026-11-04T16:45:00Z",
          expiresAt: "2026-11-04T19:30:00Z",
          policy: { allowLegacy: false },
          sources: [
            {
              id: "v2",
              role: "primary",
              kind: "hls",
              status: "pending",
              url: `https://mist-v2.korazero.com/hls/${channel}/index.m3u8`,
            },
          ],
        },
      ],
    },
  };
  return getStreamPlan(
    {
      ASSETS: {
        fetch: async (url) => new Response(JSON.stringify(files[new URL(url).pathname])),
      },
    },
    "https://korazero.com",
    new URLSearchParams({ match: matchId }),
  );
}

describe("November 4 Madrid beIN 2 audio preview", () => {
  it("opens early only when the remote has beIN 2 active", async () => {
    expect(await preview()).toMatchObject({
      status: "operator",
      selected: { playbackUrl: "https://mist-v2.korazero.com/hls/iptv-3644/index.m3u8" },
    });
  });

  it("keeps the original window for every other fixture", async () => {
    expect(await preview({ matchId: "unrelated" })).toMatchObject({
      selected: null,
      reason: "v2-before-match-window",
    });
  });

  it.each([{ active: null }, { active: "iptv-3645" }, { conflict: true }])(
    "holds when the remote is off, different or conflicted: %j",
    async (state) => {
      expect(await preview(state)).toMatchObject({ selected: null });
    },
  );

  it("does not preview another channel under the Madrid match id", async () => {
    expect(await preview({ active: "iptv-3645", channel: "iptv-3645" })).toMatchObject({
      selected: null,
      reason: "v2-before-match-window",
    });
  });

  it("cannot preview on a different date", async () => {
    expect(await preview({ at: "2026-11-03T15:00:00Z" })).toMatchObject({
      selected: null,
      reason: "v2-before-match-window",
    });
  });

  it("retains normal playback at kickoff and the existing match expiry", async () => {
    expect(await preview({ at: "2026-11-04T16:45:00Z" })).toMatchObject({ status: "operator" });
    expect(await preview({ at: "2026-11-04T19:30:00Z" })).toMatchObject({
      selected: null,
      reason: "v2-match-expired",
    });
  });
});
