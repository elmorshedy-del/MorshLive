import { fetchStaticAsset } from "../adapters/assets.js";
import { readEdgeCache, writeEdgeCache } from "../adapters/edge-cache.js";
import { parseMatchSeoPath, renderMatchSeoDocument } from "../services/match-seo.js";

export const matchSeoRoute = {
  name: "match-seo",
  methods: ["GET"],
  test: (url) => Boolean(parseMatchSeoPath(url.pathname)),
  async handle({ request, env, ctx, url }) {
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cached = await readEdgeCache(cacheKey);
    if (cached) return cached;

    const rendered = await renderMatchSeoDocument(env, url);
    if (!rendered) return fetchStaticAsset(env, request);

    const response = new Response(rendered.html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": `public, max-age=0, s-maxage=${rendered.cacheSeconds}, stale-while-revalidate=60`,
        "Content-Language": parseMatchSeoPath(url.pathname).lang,
        "X-Content-Type-Options": "nosniff",
      },
    });
    writeEdgeCache(ctx, cacheKey, response);
    return response;
  },
};
