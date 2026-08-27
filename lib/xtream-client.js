/** IPTVnator-compatible Xtream client headers. Panels often 403 browser UAs. */

export const XTREAM_CLIENT_USER_AGENT = "VLC/3.0.18 LibVLC/3.0.18";

export function xtreamClientHeaders(extra = {}) {
  const headers = { "User-Agent": XTREAM_CLIENT_USER_AGENT };
  for (const [key, value] of Object.entries(extra)) {
    if (value == null || value === "") continue;
    headers[key] = value;
  }
  return headers;
}

export function xtreamMediaHeaders(request, { includeRange = true } = {}) {
  const headers = xtreamClientHeaders({
    Accept: request?.headers?.get?.("Accept") || "*/*",
  });
  const range = includeRange ? request?.headers?.get?.("Range") : null;
  if (range) headers.Range = range;
  return headers;
}

export function shouldRetryXtreamMediaWithoutRange(status, hadRange) {
  const code = Number(status);
  return Boolean(hadRange) && (code === 401 || code === 403);
}

export function isHttpRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function looksLikeIpHostname(hostname) {
  const host = String(hostname || "")
    .trim()
    .replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
  return host.includes(":");
}

/** Keep the panel hostname (and Host header) when a live URL 302s to a raw origin IP. */
export function rewriteXtreamRedirect(requestUrl, location) {
  let request;
  let dest;
  try {
    request = new URL(requestUrl);
    dest = new URL(location, requestUrl);
  } catch {
    return null;
  }
  if (dest.protocol !== "http:" && dest.protocol !== "https:") return null;
  if (!looksLikeIpHostname(dest.hostname)) {
    return { url: dest.toString(), resolveOverride: null };
  }
  const rewritten = new URL(request.toString());
  rewritten.pathname = dest.pathname;
  rewritten.search = dest.search;
  rewritten.hash = "";
  return { url: rewritten.toString(), resolveOverride: dest.hostname };
}
