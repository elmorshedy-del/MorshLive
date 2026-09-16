import { describe, expect, it } from "vitest";
import {
  espnScoreboardWindow,
  eventInWindow,
  mergeScoreboardPayloads,
} from "../lib/espn-scoreboard-dates.js";

const event = (id, date) => ({ id, date, competitions: [{ date }] });

describe("espnScoreboardWindow", () => {
  it("turns the homepage's -1..+7 day window into the one month it spans", () => {
    expect(espnScoreboardWindow("20260915-20260923")).toMatchObject({ months: ["202609"] });
  });

  it("asks for both months when the window straddles a boundary", () => {
    expect(espnScoreboardWindow("20260828-20260905")).toMatchObject({ months: ["202608", "202609"] });
  });

  it("covers the last day asked for, not just its midnight", () => {
    const window = espnScoreboardWindow("20260915-20260923");
    expect(eventInWindow(event("1", "2026-09-23T19:30Z"), window)).toBe(true);
    expect(eventInWindow(event("2", "2026-09-24T00:00Z"), window)).toBe(false);
    expect(eventInWindow(event("3", "2026-09-14T23:59Z"), window)).toBe(false);
  });

  it("leaves a single day and a whole month alone — ESPN still answers those", () => {
    expect(espnScoreboardWindow("20260916")).toBeNull();
    expect(espnScoreboardWindow("202609")).toBeNull();
  });

  it("refuses anything that is not a usable range rather than guessing", () => {
    expect(espnScoreboardWindow("")).toBeNull();
    expect(espnScoreboardWindow("20260923-20260915")).toBeNull();
    expect(espnScoreboardWindow("2026-09-15-2026-09-23")).toBeNull();
    // Wider than MAX_MONTHS — send it untouched instead of firing a dozen calls.
    expect(espnScoreboardWindow("20260101-20261231")).toBeNull();
  });
});

describe("mergeScoreboardPayloads", () => {
  const window = espnScoreboardWindow("20260828-20260905");

  it("keeps the league metadata and returns the window's events in kickoff order", () => {
    const merged = mergeScoreboardPayloads(
      [
        { leagues: [{ slug: "eng.1" }], events: [event("b", "2026-08-30T14:00Z")] },
        { leagues: [{ slug: "eng.1" }], events: [event("a", "2026-09-02T19:00Z")] },
      ],
      window,
    );
    expect(merged.leagues).toEqual([{ slug: "eng.1" }]);
    expect(merged.events.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("drops the days outside the window the month brought along", () => {
    const merged = mergeScoreboardPayloads(
      [{ events: [event("in", "2026-08-29T14:00Z"), event("out", "2026-08-15T14:00Z")] }],
      window,
    );
    expect(merged.events.map((e) => e.id)).toEqual(["in"]);
  });

  it("de-duplicates a fixture both months report", () => {
    const merged = mergeScoreboardPayloads(
      [{ events: [event("same", "2026-09-01T18:00Z")] }, { events: [event("same", "2026-09-01T18:00Z")] }],
      window,
    );
    expect(merged.events).toHaveLength(1);
  });

  it("keeps an event with no readable date rather than losing the fixture", () => {
    const merged = mergeScoreboardPayloads([{ events: [{ id: "tbd" }] }], window);
    expect(merged.events.map((e) => e.id)).toEqual(["tbd"]);
  });
});
