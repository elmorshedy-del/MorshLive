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
 * Live manifests stay in the Worker Cache API for ~2s. The Cache API key must
 * not be the public request URL — Cloudflare's HTTP cache would otherwise HIT
 * that entry for four hours (Browser Cache TTL) and HLS.js would freeze.
 */
export function workerOnlyCacheKeyUrl(requestUrl) {
  const url = new URL(String(requestUrl || ""), "https://korazero.com");
  url.protocol = "https:";
  url.host = "kz-worker-cache.internal";
  return url.toString();
}

function pathnameOf(target) {
  const raw = String(target || "");
  try {
    return new URL(raw).pathname;
  } catch {
    return raw.split("?")[0];
  }
}

/**
 * koralive disguises the live playlist as index.css and segments as .sss.
 * Extension-based cache rules must not treat the playlist as CSS or as .m3u8.
 */
export function isLivePlaylistTarget(target) {
  const pathname = pathnameOf(target);
  if (/\.m3u8$/i.test(pathname)) return true;
  if (/\.(?:sss|ts|m4s|mp4|m4a|aac)$/i.test(pathname)) return false;
  if (/index\.css$/i.test(pathname)) return true;
  return /\/live\/.+\.(?:css|jpg|jpeg|png|gif)$/i.test(pathname);
}

/** Extension-less proxy paths so CF Browser Cache TTL cannot pin *.m3u8 / *.css. */
export function hlsProxyBasePath(target, explicitPath) {
  if (explicitPath) return explicitPath;
  return isLivePlaylistTarget(target) ? "/wk/live" : "/wk/seg";
}

export function shouldEdgeCacheHlsTarget(target) {
  return !isLivePlaylistTarget(target);
}

/**
 * Client/CDN responses for live manifests are no-store so neither the browser
 * nor Cloudflare's HTTP cache can pin a stale live edge.
 *
 * Accept-Ranges must be none. A disguised index.css playlist plus
 * Cloudflare's 4h Browser Cache TTL freezes MEDIA-SEQUENCE; Chrome
 * Range-probes then 206-loop. Serve playlists through /wk/live (no extension).
 */
export function applyClientEdgeCacheHeaders(headers, { liveManifest = false } = {}) {
  const ttl = declaredMaxAge(headers.get("Cache-Control"));
  if (!liveManifest && (ttl == null || ttl > 2)) return headers;
  headers.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  headers.set("Accept-Ranges", "none");
  headers.set("Vary", "*");
  headers.set("Expires", "0");
  headers.set("Pragma", "no-cache");
  return headers;
}
