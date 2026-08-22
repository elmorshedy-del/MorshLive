import { errorResponse, jsonResponse } from "../http/response.js";
import { getStreamPlan } from "../services/stream-plan.js";

export const streamPlanRoute = {
  name: "stream-plan",
  methods: ["GET"],
  test: (url) => url.pathname === "/api/stream-plan",
  async handle({ env, url }) {
    try {
      const plan = await getStreamPlan(env, url.origin, url.searchParams);
      const cacheSeconds = plan.status === "verified" || plan.status === "operator" ? 15 : 5;
      return jsonResponse(plan, { cacheSeconds, proxyTag: "stream-plan" });
    } catch (error) {
      const message = String(error.message || error);
      const status = /required|unknown/i.test(message) ? 400 : 500;
      return errorResponse(message, status, "stream-plan");
    }
  },
};
