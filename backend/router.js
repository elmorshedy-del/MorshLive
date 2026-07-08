/**
 * Declarative route dispatch — same idea as Hono/Express routers, zero dependency.
 *
 * Each route: { name, methods?, test(url), handle(ctx) }
 * ctx: { request, env, ctx, url, method }
 */

export async function dispatchBackendRoutes(routes, request, env, ctx) {
  const url = new URL(request.url);
  const method = request.method;

  for (const route of routes) {
    if (route.methods && !route.methods.includes(method)) continue;
    if (!route.test(url)) continue;
    try {
      return await route.handle({ request, env, ctx, url, method });
    } catch (err) {
      console.error(`[backend/${route.name}]`, err);
      return new Response(JSON.stringify({ error: "internal error" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }
  return null;
}
