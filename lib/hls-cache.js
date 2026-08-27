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
