import { jsonResponse } from "../http/response.js";

/** Liveness probe — use in CI/monitoring; zero upstream deps. */
export const healthRoute = {
  name: "health",
  methods: ["GET", "HEAD"],
  test: (url) => url.pathname === "/api/health",
  async handle({ method }) {
    if (method === "HEAD") {
      return new Response(null, { status: 200 });
    }
    return jsonResponse(
      {
        ok: true,
        service: "morshlive",
        ts: new Date().toISOString(),
      },
      { cacheSeconds: 0, proxyTag: "health" },
    );
  },
};
