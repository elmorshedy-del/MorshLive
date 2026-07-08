import { corsHeaders } from "../http/response.js";

/** Cache headers for static JSON under /assets/data/*.json */
export const assetsDataRoute = {
  name: "assets-data",
  methods: ["GET", "HEAD"],
  test: (url) => url.pathname.startsWith("/assets/data/") && /\.json$/i.test(url.pathname),
  async handle({ request, env, method }) {
    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    for (const [k, v] of Object.entries(corsHeaders())) {
      headers.set(k, v);
    }
    return new Response(method === "HEAD" ? null : res.body, {
      status: res.status,
      headers,
    });
  },
};
