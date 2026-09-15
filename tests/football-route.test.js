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
