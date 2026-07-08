/** Standard JSON + CORS responses for API routes. */

export function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
    ...extra,
  };
}

export function jsonResponse(data, { status = 200, cacheSeconds, proxyTag } = {}) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(),
  };
  if (cacheSeconds != null) {
    headers["Cache-Control"] = `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`;
  }
  if (proxyTag) headers["X-KZ-Proxy"] = proxyTag;
  return new Response(JSON.stringify(data), { status, headers });
}

export function corsPreflightResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(),
      "Access-Control-Max-Age": "86400",
    },
  });
}

export function errorResponse(message, status = 400, proxyTag) {
  return jsonResponse({ error: message }, { status, proxyTag });
}
