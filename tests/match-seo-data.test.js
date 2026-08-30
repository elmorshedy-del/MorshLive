import { describe, expect, it } from "vitest";
import {
  enrichSeoMatchFromSummary,
  mapSeoEventStatus,
  mergeSeoMatches,
  normalizeSeoScoreboardEvent,
} from "../lib/match-seo-data.js";

function scoreboardEvent(state = "pre") {
  return {
    id: "401879286",
    date: "2026-09-05T11:30Z",
    competitions: [
      {
        date: "2026-09-05T11:30Z",
        status: {
          type: {
            state,
            completed: state === "post",
            name:
              state === "post"
                ? "STATUS_FULL_TIME"
                : state === "in"
                  ? "STATUS_IN_PROGRESS"
                  : "STATUS_SCHEDULED",
          },
        },
        venue: { fullName: "St. James' Park", address: { city: "Newcastle-upon-Tyne", country: "England" } },
        competitors: [
          {
            id: "361",
            homeAway: "home",
            score: state === "pre" ? "0" : "2",
            records: [{ type: "total", summary: "1-1-0" }],
            team: { id: "361", displayName: "Newcastle United", abbreviation: "NEW" },
          },
          {
            id: "349",
            homeAway: "away",
            score: state === "pre" ? "0" : "1",
            records: [{ type: "total", summary: "0-1-1" }],
            team: { id: "349", displayName: "AFC Bournemouth", abbreviation: "BOU" },
          },
        ],
      },
    ],
  };
}

describe("match SEO data", () => {
  it("normalizes a real fixture into a stable match leaf record", () => {
    const match = normalizeSeoScoreboardEvent(scoreboardEvent(), "eng.1");
    expect(match.id).toBe("espn-eng.1-401879286");
    expect(match.home).toBe("Newcastle United");
    expect(match.away).toBe("AFC Bournemouth");
    expect(match.kickoffUtc).toBe("2026-09-05T11:30Z");
    expect(match.leagueAr).toBe("الدوري الإنجليزي الممتاز");
    expect(match.venueInfo).toMatchObject({ name: "St. James' Park", city: "Newcastle-upon-Tyne" });
  });

  it("keeps live and completed games as the same scheduled Event entity", () => {
    expect(mapSeoEventStatus(scoreboardEvent("in").competitions[0], "live")).toBe("EventScheduled");
    expect(mapSeoEventStatus(scoreboardEvent("post").competitions[0], "ended")).toBe("EventScheduled");
  });

  it("does not publish a roster as an official lineup unless both teams have 11 starters", () => {
    const match = normalizeSeoScoreboardEvent(scoreboardEvent(), "eng.1");
    const summary = {
      header: { competitions: scoreboardEvent().competitions },
      rosters: [
        {
          homeAway: "home",
          roster: Array.from({ length: 10 }, (_, i) => ({
            starter: true,
            athlete: { displayName: `Home ${i}` },
          })),
        },
        {
          homeAway: "away",
          roster: Array.from({ length: 11 }, (_, i) => ({
            starter: true,
            athlete: { displayName: `Away ${i}` },
          })),
        },
      ],
    };
    const enriched = enrichSeoMatchFromSummary(match, summary);
    expect(enriched.lineups).toBeUndefined();
  });

  it("preserves old match pages and only changes lastmod after primary content changes", () => {
    const old = {
      ...normalizeSeoScoreboardEvent(scoreboardEvent(), "eng.1"),
      seoLastmod: "2026-08-30T10:00:00.000Z",
    };
    const same = mergeSeoMatches([old], [{ ...old }], "2026-08-30T11:00:00.000Z");
    expect(same).toHaveLength(1);
    expect(same[0].seoLastmod).toBe("2026-08-30T10:00:00.000Z");

    const changed = mergeSeoMatches(
      [old],
      [{ ...old, status: "ended", score: "2 - 1" }],
      "2026-08-30T12:00:00.000Z",
    );
    expect(changed[0].seoLastmod).toBe("2026-08-30T12:00:00.000Z");
  });
});
