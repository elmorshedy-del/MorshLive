import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildLiveSnapshot, plannedMatchIds } = require("../scripts/channel-bindings-lib.js");

const BINDING = {
  version: 13,
  embedBinding: { "bein-sports-1": "koraplus", "bein-sports-2": "koraplus" },
};

function live(id, home, away) {
  return {
    id,
    home,
    away,
    status: "live",
    channelId: "bein-sports-1",
    kickoffUtc: "2026-08-22T14:00Z",
  };
}

describe("plannedMatchIds", () => {
  it("keeps only match ids with a unique content key", () => {
    const planned = plannedMatchIds({
      plans: [
        { matchId: "a", contentKey: "match:a" },
        { matchId: "b", contentKey: "match:b" },
        { matchId: "c", contentKey: "shared" },
        { matchId: "d", contentKey: "shared" },
      ],
    });
    expect([...planned].sort()).toEqual(["a", "b"]);
  });
});

describe("buildLiveSnapshot stream-plan conflicts", () => {
  it("fails when three live games share koraplus and have no catalog plans", () => {
    const snapshot = buildLiveSnapshot(
      [
        live("espn-1", "Everton", "Crystal Palace"),
        live("espn-2", "Ipswich Town", "Sunderland"),
        live("espn-3", "Nottingham Forest", "Leeds United"),
      ],
      BINDING,
      { plans: [] },
    );
    expect(snapshot.conflicts).toHaveLength(1);
    expect(snapshot.conflicts[0].embed).toBe("koraplus");
    expect(snapshot.ok).toBe(false);
  });

  it("does not fail when each live game has its own stream-plan content key", () => {
    const snapshot = buildLiveSnapshot(
      [
        live("espn-1", "Everton", "Crystal Palace"),
        live("espn-2", "Ipswich Town", "Sunderland"),
        live("espn-3", "Nottingham Forest", "Leeds United"),
      ],
      BINDING,
      {
        plans: [
          { matchId: "espn-1", contentKey: "match:espn-1" },
          { matchId: "espn-2", contentKey: "match:espn-2" },
          { matchId: "espn-3", contentKey: "match:espn-3" },
        ],
      },
    );
    expect(snapshot.conflicts).toEqual([]);
    expect(snapshot.ok).toBe(true);
    expect(snapshot.liveCount).toBe(3);
  });
});
