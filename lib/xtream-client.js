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

export function publicIpv4WildcardHost(hostname) {
  const parts = String(hostname || "")
    .trim()
    .split(".")
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  const [a, b, c] = parts;
  const privateOrReserved =
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
  return privateOrReserved ? null : `${parts.join("-")}.sslip.io`;
}

/** Give a public origin IP a real hostname because Workers cannot fetch raw IP URLs. */
export function rewriteXtreamRedirect(requestUrl, location) {
  let dest;
  try {
    dest = new URL(location, requestUrl);
  } catch {
    return null;
  }
  if (dest.protocol !== "http:" && dest.protocol !== "https:") return null;
  const wildcardHost = publicIpv4WildcardHost(dest.hostname);
  if (wildcardHost) dest.hostname = wildcardHost;
  return dest.toString();
}
