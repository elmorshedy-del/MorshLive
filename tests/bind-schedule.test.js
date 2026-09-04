import { describe, expect, it } from "vitest";
import { bindActionForMatch, isBindLeagueMatch, planBindLoop } from "../lib/bind-schedule.js";

const NOW = Date.parse("2026-08-29T19:41:00Z");

describe("bindActionForMatch", () => {
  it("executes kickoff when the match already started and is still in window", () => {
    expect(bindActionForMatch({ kickoffUtc: "2026-08-29T19:30:00Z", now: NOW })).toEqual({
      check: "kickoff",
      executeNow: true,
      fireAt: Date.parse("2026-08-29T19:30:00Z"),
    });
  });

  it("skips a match outside the live TV window", () => {
    expect(bindActionForMatch({ kickoffUtc: "2026-08-29T16:30:00Z", now: NOW })).toBeNull();
  });

  it("arms the deterministic preflight at T-30", () => {
    expect(bindActionForMatch({ kickoffUtc: "2026-08-30T13:00:00Z", now: NOW })).toEqual({
      check: "prematch",
      executeNow: false,
      fireAt: Date.parse("2026-08-30T12:30:00Z"),
    });
  });

  it("runs the preflight immediately when T-30 was missed", () => {
    expect(
      bindActionForMatch({ kickoffUtc: "2026-08-30T15:00:00Z", now: Date.parse("2026-08-30T14:48:00Z") }),
    ).toEqual({
      check: "prematch",
      executeNow: true,
      fireAt: Date.parse("2026-08-30T14:30:00Z"),
    });
  });
});

describe("planBindLoop", () => {
  it("runs tonight's live game now and arms Sunday T-30 preflights", () => {
    const plan = planBindLoop(
      [
        {
          matchId: "espn-esp.1-401882897",
          home: "Sevilla",
          away: "Atlético Madrid",
          kickoffUtc: "2026-08-29T19:30:00Z",
        },
        {
          matchId: "espn-eng.1-401879312",
          home: "Tottenham",
          away: "Newcastle",
          kickoffUtc: "2026-08-29T16:30:00Z",
        },
        {
          matchId: "espn-eng.1-401879317",
          home: "Chelsea",
          away: "Brighton",
          kickoffUtc: "2026-08-30T13:00:00Z",
        },
        {
          matchId: "espn-esp.1-401882899",
          home: "Real Madrid",
          away: "Málaga",
          kickoffUtc: "2026-08-30T15:00:00Z",
        },
      ],
      NOW,
    );
    expect(plan.executeNow.map((row) => row.matchId)).toEqual(["espn-esp.1-401882897"]);
    expect(plan.executeNow[0].check).toBe("kickoff");
    expect(plan.arm.map((row) => row.matchId)).toEqual(["espn-eng.1-401879317", "espn-esp.1-401882899"]);
    expect(plan.arm.every((row) => row.check === "prematch")).toBe(true);
  });

  it("covers Saudi and Champions League with the same deterministic schedule", () => {
    expect(isBindLeagueMatch({ matchId: "espn-ksa.1-401900376", competition: "spl" })).toBe(true);
    expect(isBindLeagueMatch({ matchId: "espn-uefa.champions-401909192", competition: "ucl" })).toBe(true);
    const plan = planBindLoop(
      [
        {
          matchId: "espn-ksa.1-401900376",
          competition: "spl",
          home: "Al Qadsiah",
          away: "Al-Faisaly",
          kickoffUtc: "2026-08-30T18:00:00Z",
        },
        {
          matchId: "espn-uefa.champions-401909192",
          competition: "ucl",
          home: "Celtic",
          away: "LASK",
          kickoffUtc: "2026-08-30T18:00:00Z",
        },
      ],
      Date.parse("2026-08-30T17:20:00Z"),
    );
    expect(plan.arm.map((row) => row.matchId)).toEqual([
      "espn-ksa.1-401900376",
      "espn-uefa.champions-401909192",
    ]);
    expect(plan.executeNow).toEqual([]);
  });
});
