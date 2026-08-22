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
      "uefa.champions",
      "uefa.champions_qual",
    ]);
    expect(upstream).toHaveBeenCalledTimes(4);
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
