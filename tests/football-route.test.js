import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchBackendRoutes } from "../backend/router.js";
import { footballRoute } from "../backend/routes/football.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("football routes", () => {
  it("aggregates every supported competition behind one cached endpoint", async () => {
    const upstream = vi.fn(async (url) => {
      const slug = String(url).split("/soccer/")[1].split("/")[0];
      return new Response(JSON.stringify({ leagues: [{ slug }], events: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", upstream);

    const res = await dispatchBackendRoutes(
      [footballRoute],
      new Request("https://korazero.com/api/football/scoreboard?dates=20260821-20260829"),
      {},
      {},
    );

    expect(res?.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=30");
    const body = await res.json();
    expect(body.leagues.map((row) => row.slug)).toEqual([
      "eng.1",
      "esp.1",
      "ksa.1",
      "uefa.champions",
      "uefa.champions_qual",
    ]);
    expect(upstream).toHaveBeenCalledTimes(5);
  });

  it("recovers with single-day ESPN calls when a wide date range fails", async () => {
    const upstream = vi.fn(async (url) => {
      const parsed = new URL(String(url));
      const slug = parsed.pathname.split("/soccer/")[1].split("/")[0];
      const dates = parsed.searchParams.get("dates");

      if (dates === "20260821-20260829") {
        return new Response("upstream timeout", { status: 504 });
      }

      if (dates === "20260821" || dates === "20260823") {
        return new Response(
          JSON.stringify({
            leagues: [
              {
                slug,
                calendar: ["2026-08-21T07:00Z", "2026-08-23T07:00Z"],
              },
            ],
            events: [
              {
                id: `${slug}-${dates}`,
                date: `${dates.slice(0, 4)}-${dates.slice(4, 6)}-${dates.slice(6, 8)}T12:00:00Z`,
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("unexpected date", { status: 404 });
    });
    vi.stubGlobal("fetch", upstream);

    const res = await dispatchBackendRoutes(
      [footballRoute],
      new Request("https://korazero.com/api/football/scoreboard?dates=20260821-20260829"),
      {},
      {},
    );

    expect(res?.status).toBe(200);
    const body = await res.json();
    expect(body.unavailable).toEqual([]);
    expect(body.leagues).toHaveLength(5);
    expect(body.leagues.every((row) => row.data.events.length === 2)).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(15);
  });

  it("recovers match cards from TheSportsDB when ESPN is unavailable", async () => {
    const upstream = vi.fn(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === "www.thesportsdb.com") {
        const date = parsed.searchParams.get("d");
        const events = date === "2026-09-16"
          ? [
              {
                idEvent: "2506227",
                strTimestamp: "2026-09-16T15:00:00",
                strEvent: "Rayo Vallecano vs Espanyol",
                strLeague: "Spanish La Liga",
                strHomeTeam: "Rayo Vallecano",
                strAwayTeam: "Espanyol",
                strHomeTeamBadge: "https://example.com/rayo.png",
                strAwayTeamBadge: "https://example.com/espanyol.png",
                intHomeScore: null,
                intAwayScore: null,
                strStatus: "NS",
                strVenue: "Estadio de Vallecas",
                strCountry: "Spain",
              },
            ]
          : [];
        return new Response(JSON.stringify({ events }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("espn unavailable", { status: 500 });
    });
    vi.stubGlobal("fetch", upstream);

    const res = await dispatchBackendRoutes(
      [footballRoute],
      new Request("https://korazero.com/api/football/scoreboard?dates=20260915-20260916"),
      {},
      {},
    );

    expect(res?.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("thesportsdb");
    expect(body.unavailable).toEqual([]);
    const laliga = body.leagues.find((row) => row.slug === "esp.1");
    expect(laliga.data.events).toHaveLength(1);
    expect(laliga.data.events[0]).toMatchObject({
      id: "2506227",
      date: "2026-09-16T15:00:00Z",
      name: "Rayo Vallecano vs Espanyol",
      source: "thesportsdb",
      competitions: [
        {
          status: { type: { state: "pre", completed: false } },
          competitors: [
            { homeAway: "home", team: { displayName: "Rayo Vallecano" } },
            { homeAway: "away", team: { displayName: "Espanyol" } },
          ],
        },
      ],
    });
  });

  it("proxies an allowlisted ESPN match summary for live detail", async () => {
    const upstream = vi.fn(
      async () =>
        new Response(JSON.stringify({ header: { id: "401999999" }, keyEvents: [] }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", upstream);

    const res = await dispatchBackendRoutes(
      [footballRoute],
      new Request("https://korazero.com/api/football/summary?league=eng.1&event=401999999"),
      {},
      {},
    );

    expect(res?.status).toBe(200);
    expect(res.headers.get("x-kz-proxy")).toBe("espn-summary");
    expect(await res.json()).toMatchObject({ header: { id: "401999999" } });
  });
});
