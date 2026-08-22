import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { extractGoals, shouldFetchMatchDetail } = require("../scripts/match-detail-lib.js");

// Real shape from ESPN event 760499, Australia vs Egypt, final score 1-1.
// teamId 628 = home = Australia, teamId 2620 = away = Egypt.
function buildSummary(extraEvents = []) {
  return {
    header: {
      competitions: [
        {
          competitors: [
            { id: "628", homeAway: "home", team: { id: "628" } },
            { id: "2620", homeAway: "away", team: { id: "2620" } },
          ],
        },
      ],
    },
    keyEvents: [
      {
        scoringPlay: true,
        type: { type: "goal---header" },
        team: { id: 2620 },
        participants: [{ athlete: { displayName: "Emam Ashour" } }],
        clock: { displayValue: "23'", value: 23 },
        period: { number: 1 },
      },
      {
        scoringPlay: true,
        type: { type: "own-goal" },
        team: { id: 628 },
        participants: [{ athlete: { displayName: "Mohamed Hany" } }],
        clock: { displayValue: "67'", value: 67 },
        period: { number: 2 },
      },
      ...extraEvents,
    ],
  };
}

describe("extractGoals", () => {
  it("attributes goals to the side ESPN reports, without flipping own goals", () => {
    const goals = extractGoals(buildSummary());

    const normal = goals.find((g) => g.scorer === "E. Ashour");
    expect(normal.side).toBe("away");
    expect(normal.own).toBe(false);

    const ownGoal = goals.find((g) => g.scorer === "M. Hany");
    expect(ownGoal.side).toBe("home");
    expect(ownGoal.own).toBe(true);

    const homeCount = goals.filter((g) => g.side === "home").length;
    const awayCount = goals.filter((g) => g.side === "away").length;
    expect(homeCount).toBe(1);
    expect(awayCount).toBe(1);
  });

  it("excludes shootout events from the timeline", () => {
    const shootoutEvent = {
      scoringPlay: true,
      type: { type: "shootout-goal" },
      team: { id: 628 },
      participants: [{ athlete: { displayName: "Some Player" } }],
      clock: { displayValue: "0'", value: 0 },
      period: { number: 5 },
    };
    const goals = extractGoals(buildSummary([shootoutEvent]));
    expect(goals.some((g) => g.scorer === "S. Player")).toBe(false);
    expect(goals).toHaveLength(2);
  });
});

describe("shouldFetchMatchDetail", () => {
  const now = Date.parse("2026-08-22T08:00:00Z");

  it("fetches live details and near-kickoff lineups", () => {
    expect(shouldFetchMatchDetail({
      id: "espn-eng.1-401999999",
      status: "live",
      kickoffUtc: "2026-08-22T07:00:00Z",
    }, now)).toBe(true);
    expect(shouldFetchMatchDetail({
      id: "espn-esp.1-401999998",
      status: "upcoming",
      kickoffUtc: "2026-08-22T12:00:00Z",
    }, now)).toBe(true);
  });

  it("does not request summaries for the distant schedule", () => {
    expect(shouldFetchMatchDetail({
      id: "espn-uefa.champions_qual-401999997",
      status: "upcoming",
      kickoffUtc: "2026-08-25T18:00:00Z",
    }, now)).toBe(false);
  });
});
