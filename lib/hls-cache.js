function normalizedTtl(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function declaredMaxAge(cacheControl) {
  const value = String(cacheControl || "");
  const shared = value.match(/(?:^|,)\s*s-maxage=(\d+)/i);
  const browser = value.match(/(?:^|,)\s*max-age=(\d+)/i);
  const raw = shared?.[1] ?? browser?.[1];
  return raw == null ? null : Number(raw);
}

/**
 * Preserve a producer's shorter freshness window without letting it exceed
 * the cache wrapper's upper bound. Live manifests use 2s; segments use 60s.
 */
export function effectiveEdgeCacheTtl(cacheControl, fallbackTtl) {
  const fallback = normalizedTtl(fallbackTtl);
  const declared = declaredMaxAge(cacheControl);
  return declared == null ? fallback : Math.min(fallback, normalizedTtl(declared));
}

/**
 * Live manifests stay in the Worker Cache API for ~2s, but Cloudflare's HTTP
 * cache treats `public, max-age=2` on `/wk/stream.m3u8` as a 4-hour HIT
 * (Browser Cache TTL). HLS.js then refetches the same frozen live edge.
 */
export function applyClientEdgeCacheHeaders(headers) {
  const ttl = declaredMaxAge(headers.get("Cache-Control"));
  if (ttl == null || ttl > 2) return headers;
  headers.set("Cache-Control", "no-store");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  return headers;
}
