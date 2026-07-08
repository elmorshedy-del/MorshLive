import { describe, expect, it } from "vitest";
import { dispatchBackendRoutes } from "../backend/router.js";
import { healthRoute } from "../backend/routes/health.js";

describe("dispatchBackendRoutes", () => {
  it("dispatches matching route", async () => {
    const res = await dispatchBackendRoutes(
      [healthRoute],
      new Request("https://korazero.com/api/health"),
      {},
      {},
    );
    expect(res?.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns null when no route matches", async () => {
    const res = await dispatchBackendRoutes(
      [healthRoute],
      new Request("https://korazero.com/api/nope"),
      {},
      {},
    );
    expect(res).toBeNull();
  });
});
