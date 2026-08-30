export async function readEdgeCache(request) {
  if (typeof caches === "undefined" || !caches.default) return null;
  return caches.default.match(request);
}

export function writeEdgeCache(ctx, request, response) {
  if (!ctx?.waitUntil || typeof caches === "undefined" || !caches.default) return;
  ctx.waitUntil(caches.default.put(request, response.clone()));
}
