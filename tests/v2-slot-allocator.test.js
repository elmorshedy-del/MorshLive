import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allocateSlots, scoreMatch } from "../lib/v2-slot-allocator.js";

const starterPriority = JSON.parse(readFileSync("assets/data/v2-match-priority.json", "utf8"));
const oct14 = JSON.parse(readFileSync("tests/fixtures/v2-allocator-2026-10-14.json", "utf8"));

function binding({
  matchId,
  home = "Low A",
  away = "Low B",
  competition = "ucl",
  kickoffUtc = "2026-10-18T10:00:00Z",
  streamId,
}) {
  return { matchId, home, away, competition, kickoffUtc, streamId: String(streamId) };
}

function previousEntry({
  slot,
  matchId,
  streamId,
  startAt,
  endAt,
  score = 0,
}) {
  return {
    slot,
    matchId,
    streamId: String(streamId),
    channelId: `iptv-${streamId}`,
    startAt,
    endAt,
    score,
    reasons: [],
    pinned: false,
  };
}

describe("scoreMatch", () => {
  it("explains competition, team tiers, rivalry and big-game bonuses", () => {
    const result = scoreMatch(
      binding({
        matchId: "clasico",
        home: "Real Madrid",
        away: "Barcelona",
        competition: "laliga",
        streamId: "3645",
      }),
      starterPriority,
    );
    expect(result.score).toBe(160);
    expect(result.reasons).toEqual([
      "competition:laliga+40",
      "tier1:Real Madrid+30",
      "tier1:Barcelona+30",
      "rivalry+40",
      "big-game+20",
    ]);
  });
});

describe("allocateSlots", () => {
  it("places the two highest-scoring overlapping matches and names both blockers for the loser", () => {
    const priority = {
      competition: { ucl: 10 },
      tier1: 20,
      tier2: 5,
      rivalryBonus: 0,
      bigGameBonus: 0,
      teams: { tier1: ["Top A", "Top B"], tier2: ["Mid"] },
      rivalries: [],
    };
    const result = allocateSlots({
      bindings: [
        binding({ matchId: "top", home: "Top A", away: "Low", streamId: "1" }),
        binding({ matchId: "mid", home: "Mid", away: "Low", streamId: "2" }),
        binding({ matchId: "low", streamId: "3" }),
      ],
      slots: ["a", "b"],
      priority,
      pins: {},
      previous: null,
      now: Date.parse("2026-10-18T08:00:00Z"),
    });

    expect(result.entries.map((entry) => entry.matchId)).toEqual(["top", "mid"]);
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0]).toMatchObject({
      matchId: "low",
      reason: "outranked",
      by: ["mid", "top"],
    });
  });

  it("puts El Clasico on slot a ahead of lower-scoring simultaneous matches", () => {
    const result = allocateSlots({
      bindings: [
        binding({
          matchId: "clasico",
          home: "Real Madrid",
          away: "Barcelona",
          competition: "laliga",
          streamId: "3645",
        }),
        binding({
          matchId: "arsenal-brentford",
          home: "Arsenal",
          away: "Brentford",
          competition: "epl",
          streamId: "3653",
        }),
        binding({
          matchId: "lens-nantes",
          home: "Lens",
          away: "Nantes",
          competition: "ligue1",
          streamId: "3652",
        }),
      ],
      slots: ["a", "b"],
      priority: starterPriority,
      now: Date.parse("2026-10-18T08:00:00Z"),
    });

    expect(result.entries.find((entry) => entry.matchId === "clasico")).toMatchObject({
      slot: "a",
      score: 160,
    });
    expect(result.unassigned.map((entry) => entry.matchId)).toContain("lens-nantes");
  });

  it("breaks ties by earlier startAt then matchId and is byte-deterministic", () => {
    const args = {
      bindings: [
        binding({
          matchId: "later-z",
          kickoffUtc: "2026-10-18T10:10:00Z",
          competition: "none",
          streamId: "10",
        }),
        binding({
          matchId: "later-a",
          kickoffUtc: "2026-10-18T10:10:00Z",
          competition: "none",
          streamId: "11",
        }),
        binding({
          matchId: "earlier",
          kickoffUtc: "2026-10-18T10:00:00Z",
          competition: "none",
          streamId: "12",
        }),
      ],
      slots: ["a", "b"],
      priority: {},
      pins: {},
      previous: null,
      now: Date.parse("2026-10-18T08:00:00Z"),
    };
    const first = allocateSlots(args);
    const second = allocateSlots(args);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.entries.map((entry) => entry.matchId)).toEqual(["earlier", "later-a"]);
    expect(first.unassigned[0].matchId).toBe("later-z");
  });

  it("freezes an already-started lower-score entry instead of cutting it for a new winner", () => {
    const now = Date.parse("2026-10-18T10:05:00Z");
    const result = allocateSlots({
      bindings: [
        binding({
          matchId: "started-low",
          kickoffUtc: "2026-10-18T10:00:00Z",
          competition: "ligue1",
          streamId: "100",
        }),
        binding({
          matchId: "new-high",
          home: "Real Madrid",
          away: "Barcelona",
          kickoffUtc: "2026-10-18T10:10:00Z",
          competition: "laliga",
          streamId: "101",
        }),
      ],
      slots: ["a", "b"],
      priority: starterPriority,
      previous: {
        entries: [
          previousEntry({
            slot: "a",
            matchId: "started-low",
            streamId: "100",
            startAt: "2026-10-18T09:45:00.000Z",
            endAt: "2026-10-18T12:00:00.000Z",
          }),
        ],
      },
      now,
    });

    expect(result.entries.find((entry) => entry.matchId === "started-low")?.slot).toBe("a");
    expect(result.entries.find((entry) => entry.matchId === "new-high")?.slot).toBe("b");
  });

  it("requires a whole-window fit and never splits a match across slots", () => {
    const now = Date.parse("2026-10-18T10:05:00Z");
    const candidate = binding({
      matchId: "whole-window",
      kickoffUtc: "2026-10-18T10:15:00Z",
      streamId: "200",
      competition: "none",
    });
    const result = allocateSlots({
      bindings: [
        candidate,
        binding({
          matchId: "left-block",
          kickoffUtc: "2026-10-18T09:15:00Z",
          streamId: "201",
          competition: "none",
        }),
        binding({
          matchId: "right-block",
          kickoffUtc: "2026-10-18T10:45:00Z",
          streamId: "202",
          competition: "none",
        }),
      ],
      slots: ["a", "b"],
      priority: {},
      previous: {
        entries: [
          previousEntry({
            slot: "a",
            matchId: "left-block",
            streamId: "201",
            startAt: "2026-10-18T09:00:00.000Z",
            endAt: "2026-10-18T11:15:00.000Z",
          }),
          previousEntry({
            slot: "b",
            matchId: "right-block",
            streamId: "202",
            startAt: "2026-10-18T09:30:00.000Z",
            endAt: "2026-10-18T12:45:00.000Z",
          }),
        ],
      },
      now,
    });

    expect(result.entries.some((entry) => entry.matchId === "whole-window")).toBe(false);
    expect(result.unassigned.find((entry) => entry.matchId === "whole-window")?.reason).toBe("outranked");
  });

  it("honors must and never pins ahead of normal score", () => {
    const result = allocateSlots({
      bindings: [
        binding({
          matchId: "must-low",
          competition: "ligue1",
          streamId: "300",
        }),
        binding({
          matchId: "high",
          home: "Real Madrid",
          away: "Barcelona",
          competition: "laliga",
          streamId: "301",
        }),
        binding({
          matchId: "never-high",
          home: "Liverpool",
          away: "Manchester City",
          competition: "epl",
          streamId: "302",
        }),
      ],
      slots: ["a", "b"],
      priority: starterPriority,
      pins: { "must-low": "must", "never-high": "never" },
      now: Date.parse("2026-10-18T08:00:00Z"),
    });

    expect(result.entries.find((entry) => entry.matchId === "must-low")).toMatchObject({
      slot: "a",
      pinned: true,
    });
    expect(result.entries.some((entry) => entry.matchId === "never-high")).toBe(false);
    expect(result.unassigned.find((entry) => entry.matchId === "never-high")).toMatchObject({
      reason: "pinned-never",
    });
  });

  it("keeps a back-to-back use of the same stream on the same slot", () => {
    const result = allocateSlots({
      bindings: [
        binding({
          matchId: "first",
          kickoffUtc: "2026-10-18T10:00:00Z",
          streamId: "400",
          competition: "none",
        }),
        binding({
          matchId: "z-other",
          kickoffUtc: "2026-10-18T12:15:00Z",
          streamId: "401",
          competition: "none",
        }),
        binding({
          matchId: "second",
          kickoffUtc: "2026-10-18T12:15:00Z",
          streamId: "400",
          competition: "none",
        }),
      ],
      slots: ["a", "b"],
      priority: {},
      now: Date.parse("2026-10-18T08:00:00Z"),
    });

    const first = result.entries.find((entry) => entry.matchId === "first");
    const second = result.entries.find((entry) => entry.matchId === "second");
    expect(first?.slot).toBe("a");
    expect(second?.slot).toBe("a");
  });

  it("never emits the same stream on overlapping slots across deterministic generated fixtures", () => {
    let seed = 73;
    const random = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    const bindings = [];
    for (let index = 0; index < 30; index += 1) {
      const minute = Math.floor(random() * 360);
      bindings.push(binding({
        matchId: `r-${index}`,
        kickoffUtc: new Date(Date.parse("2026-10-18T10:00:00Z") + minute * 60_000).toISOString(),
        streamId: String(500 + index),
        competition: "none",
      }));
    }

    const result = allocateSlots({
      bindings,
      slots: ["a", "b"],
      priority: {},
      now: Date.parse("2026-10-18T08:00:00Z"),
    });

    for (let i = 0; i < result.entries.length; i += 1) {
      for (let j = i + 1; j < result.entries.length; j += 1) {
        const left = result.entries[i];
        const right = result.entries[j];
        if (left.streamId !== right.streamId) continue;
        const overlaps = Date.parse(left.startAt) < Date.parse(right.endAt)
          && Date.parse(right.startAt) < Date.parse(left.endAt);
        expect(overlaps).toBe(false);
      }
    }
  });

  it("returns an empty schedule for empty or fully expired bindings", () => {
    const now = Date.parse("2026-10-18T15:00:00Z");
    const result = allocateSlots({
      bindings: [
        binding({
          matchId: "expired",
          kickoffUtc: "2026-10-18T10:00:00Z",
          streamId: "600",
        }),
      ],
      slots: ["a", "b"],
      priority: {},
      now,
    });
    expect(result.entries).toEqual([]);
    expect(result.unassigned).toEqual([]);

    const empty = allocateSlots({ bindings: [], slots: ["a", "b"], priority: {}, now });
    expect(empty.entries).toEqual([]);
    expect(empty.unassigned).toEqual([]);
  });

  it("replays Oct 14 with both early games and the two highest-priority 19:00 games", () => {
    const result = allocateSlots({
      bindings: oct14,
      slots: ["a", "b"],
      priority: starterPriority,
      pins: {},
      now: Date.parse("2026-10-14T12:00:00Z"),
    });

    const at1645 = new Set(
      result.entries
        .filter((entry) => Date.parse(entry.startAt) === Date.parse("2026-10-14T16:30:00Z"))
        .map((entry) => entry.matchId),
    );
    expect(at1645).toEqual(new Set(["oct14-lask-liverpool", "oct14-feyenoord-como"]));

    const at1900 = new Set(
      result.entries
        .filter((entry) => Date.parse(entry.startAt) === Date.parse("2026-10-14T18:45:00Z"))
        .map((entry) => entry.matchId),
    );
    expect(at1900).toEqual(new Set(["oct14-city-psg", "oct14-roma-real"]));

    const unassigned1900 = new Set(
      result.unassigned
        .filter((entry) => entry.matchId.startsWith("oct14-"))
        .map((entry) => entry.matchId)
        .filter((id) => !["oct14-lask-liverpool", "oct14-feyenoord-como"].includes(id)),
    );
    expect(unassigned1900).toEqual(new Set([
      "oct14-bodo-dortmund",
      "oct14-villa-fenerbahce",
      "oct14-betis-porto",
      "oct14-shakhtar-aek",
      "oct14-slovan-stuttgart",
    ]));
    for (const loser of result.unassigned.filter((entry) => unassigned1900.has(entry.matchId))) {
      expect(new Set(loser.by)).toEqual(new Set(["oct14-city-psg", "oct14-roma-real"]));
    }
  });
});
