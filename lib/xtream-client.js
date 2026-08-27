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
