const TOKEN_TTL_SECONDS = 6 * 60 * 60;
const keyCache = new Map();
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const padded = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const normalized = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function tokenKey(env) {
  const secret = env && (env.XTREAM_TOKEN_SECRET || env.STREAM_SIGNING_SECRET);
  if (!secret) throw new Error("XTREAM_TOKEN_SECRET or STREAM_SIGNING_SECRET is required");
  const cacheKey = String(secret);
  if (keyCache.has(cacheKey)) return keyCache.get(cacheKey);
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(cacheKey));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  keyCache.set(cacheKey, key);
  return key;
}

export function safePortalUrl(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function loadXtreamPortals(env) {
  const raw = env && (env.XTREAM_PORTALS_JSON || env.IPTV_PORTALS_JSON);
  if (!raw) return { portals: [], error: "XTREAM_PORTALS_JSON secret is not configured" };

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.portals) ? parsed.portals : [];
    const portals = [];

    list.forEach((item, index) => {
      const value = item?.portal ? item.portal : item;
      const url = safePortalUrl(value.url || value.portalUrl || value.host);
      const username = value.username || value.user;
      const password = value.password || value.pass;
      if (!url || !username || !password) return;
      portals.push({
        id: `p${index + 1}`,
        label: String(value.label || value.name || `Portal ${index + 1}`),
        url,
        username: String(username),
        password: String(password),
        expiry: item.expiry || value.expiry || null,
        maxConnections: item.maxConnections || value.maxConnections || null,
        activeConnections: item.activeConnections || value.activeConnections || null,
      });
    });

    return { portals };
  } catch (error) {
    return { portals: [], error: `Invalid XTREAM_PORTALS_JSON: ${error.message || error}` };
  }
}

function apiUrl(portal, action) {
  const url = new URL(`${portal.url}/player_api.php`);
  url.searchParams.set("username", portal.username);
  url.searchParams.set("password", portal.password);
  if (action) url.searchParams.set("action", action);
  return url.toString();
}

export function streamUrl(portal, streamId, extension = "m3u8") {
  const safeId = String(streamId || "").replace(/[^0-9]/g, "");
  if (!safeId) throw new Error("Invalid Xtream stream id");
  const ext = extension === "ts" ? "ts" : "m3u8";
  return `${portal.url}/live/${encodeURIComponent(portal.username)}/${encodeURIComponent(portal.password)}/${safeId}.${ext}`;
}

async function probeMediaUrl(url, kind, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: kind === "hls" ? "application/vnd.apple.mpegurl,*/*" : "video/mp2t,*/*",
        Range: "bytes=0-1879",
        "User-Agent": "Mozilla/5.0 (KoraZero Xtream Probe)",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return { ok: false, status: response.status, protocol: kind };
    const reader = response.body.getReader();
    const { value } = await reader.read();
    try {
      await reader.cancel();
    } catch {
      /* noop */
    }
    const bytes = value || new Uint8Array();
    if (kind === "hls") {
      const text = textDecoder.decode(bytes.slice(0, 4096)).trimStart();
      return { ok: text.startsWith("#EXTM3U"), status: response.status, protocol: kind, bytes: bytes.length };
    }
    const sync = bytes.length > 0 && (bytes[0] === 0x47 || (bytes.length > 188 && bytes[188] === 0x47));
    return { ok: sync, status: response.status, protocol: kind, bytes: bytes.length };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      protocol: kind,
      error: error.name === "AbortError" ? "timeout" : String(error.message || error),
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function probeXtreamPlayback(portal, streamId) {
  const hls = await probeMediaUrl(streamUrl(portal, streamId, "m3u8"), "hls");
  if (hls.ok) return hls;
  const ts = await probeMediaUrl(streamUrl(portal, streamId, "ts"), "ts");
  return ts.ok ? ts : { ok: false, hls, ts };
}

export async function fetchXtreamJson(portal, action, timeoutMs = 14000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl(portal, action), {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "Mozilla/5.0 (KoraZero Xtream Importer)",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response (${text.slice(0, 80).replace(/\s+/g, " ")})`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function createMediaToken(env, upstreamUrl, ttlSeconds = TOKEN_TTL_SECONDS) {
  const url = new URL(upstreamUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported media URL");
  const payload = JSON.stringify({
    v: 1,
    u: url.toString(),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(env), textEncoder.encode(payload)),
  );
  const output = new Uint8Array(iv.length + ciphertext.length);
  output.set(iv, 0);
  output.set(ciphertext, iv.length);
  return toBase64Url(output);
}

export async function decodeMediaToken(env, token) {
  const bytes = fromBase64Url(token);
  if (bytes.length < 29) throw new Error("Invalid media token");
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  let payload;
  try {
    const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await tokenKey(env), ciphertext);
    payload = JSON.parse(textDecoder.decode(clear));
  } catch {
    throw new Error("Invalid media token");
  }
  if (payload?.v !== 1 || !payload.u || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
    throw new Error("Expired media token");
  }
  const url = new URL(payload.u);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported media URL");
  return url.toString();
}

async function replaceAsync(value, expression, replacer) {
  const matches = [...value.matchAll(expression)];
  if (!matches.length) return value;
  const replacements = await Promise.all(matches.map((match) => replacer(match)));
  let output = "";
  let cursor = 0;
  matches.forEach((match, index) => {
    output += value.slice(cursor, match.index) + replacements[index];
    cursor = match.index + match[0].length;
  });
  return output + value.slice(cursor);
}

async function rewriteManifest(text, manifestUrl, env) {
  const proxyUrl = async (raw) => {
    const target = new URL(raw, manifestUrl).toString();
    const token = await createMediaToken(env, target);
    return `/api/xtream/media/${token}`;
  };

  const lines = await Promise.all(
    String(text || "")
      .split(/\r?\n/)
      .map(async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (!trimmed.startsWith("#")) return proxyUrl(trimmed);
        return replaceAsync(line, /URI=("([^"]+)"|'([^']+)')/g, async (match) => {
          const quote = match[1][0];
          const raw = match[2] || match[3] || "";
          return `URI=${quote}${await proxyUrl(raw)}${quote}`;
        });
      }),
  );
  return lines.join("\n");
}

function mediaHeaders(response, extra = {}) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "X-KZ-Proxy": "xtream-media",
    ...extra,
  };
  for (const name of ["Content-Range", "Accept-Ranges"]) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

export async function proxyXtreamMedia(request, env, token) {
  const target = await decodeMediaToken(env, token);
  const upstreamHeaders = {
    Accept: request.headers.get("Accept") || "*/*",
    "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
  };
  const range = request.headers.get("Range");
  if (range) upstreamHeaders.Range = range;

  const response = await fetch(target, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: upstreamHeaders,
    redirect: "follow",
  });
  if (!response.ok) {
    return new Response(request.method === "HEAD" ? null : `Upstream error ${response.status}`, {
      status: response.status,
      headers: mediaHeaders(response),
    });
  }

  const type = (response.headers.get("Content-Type") || "").toLowerCase();
  const isManifest = type.includes("mpegurl") || type.includes("m3u8") || /\.m3u8(?:\?|$)/i.test(target);
  if (isManifest) {
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: mediaHeaders(response, { "Content-Type": "application/vnd.apple.mpegurl" }),
      });
    }
    const rewritten = await rewriteManifest(await response.text(), target, env);
    return new Response(rewritten, {
      status: 200,
      headers: mediaHeaders(response, { "Content-Type": "application/vnd.apple.mpegurl" }),
    });
  }

  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    headers: mediaHeaders(response, {
      "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
    }),
  });
}
