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

export function inspectMpegTsCodecs(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let pmtPid = -1;
  const streamTypes = [];

  const payloadStart = (offset) => {
    if (data[offset] !== 0x47) return -1;
    const control = (data[offset + 3] >> 4) & 0x03;
    if (control === 0 || control === 2) return -1;
    let start = offset + 4;
    if (control === 3) start += 1 + data[offset + 4];
    if (start >= offset + 188) return -1;
    if (data[offset + 1] & 0x40) start += 1 + data[start];
    return start < offset + 188 ? start : -1;
  };

  for (let offset = 0; offset + 188 <= data.length; offset += 188) {
    if (data[offset] !== 0x47) continue;
    const pid = ((data[offset + 1] & 0x1f) << 8) | data[offset + 2];
    const start = payloadStart(offset);
    if (start < 0) continue;
    if (pid === 0 && data[start] === 0x00) {
      const sectionLength = ((data[start + 1] & 0x0f) << 8) | data[start + 2];
      const end = Math.min(start + 3 + sectionLength - 4, offset + 188);
      for (let pos = start + 8; pos + 4 <= end; pos += 4) {
        const programNumber = (data[pos] << 8) | data[pos + 1];
        if (programNumber) {
          pmtPid = ((data[pos + 2] & 0x1f) << 8) | data[pos + 3];
          break;
        }
      }
    } else if (pid === pmtPid && data[start] === 0x02) {
      const sectionLength = ((data[start + 1] & 0x0f) << 8) | data[start + 2];
      const programInfoLength = ((data[start + 10] & 0x0f) << 8) | data[start + 11];
      const end = Math.min(start + 3 + sectionLength - 4, offset + 188);
      let pos = start + 12 + programInfoLength;
      while (pos + 5 <= end) {
        const type = data[pos];
        const infoLength = ((data[pos + 3] & 0x0f) << 8) | data[pos + 4];
        streamTypes.push(type);
        pos += 5 + infoLength;
      }
      break;
    }
  }

  const video = streamTypes.includes(0x1b) ? "h264" : streamTypes.includes(0x24) ? "hevc" : null;
  const audio = streamTypes.some((type) => type === 0x0f || type === 0x11)
    ? "aac"
    : streamTypes.includes(0x81)
      ? "ac3"
      : streamTypes.some((type) => type === 0x03 || type === 0x04)
        ? "mp2"
        : null;
  return {
    video,
    audio,
    mobileCompatible: video === "h264" && (audio === "aac" || audio === null),
  };
}

async function fetchProbeBytes(url, accept, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: accept,
        Range: "bytes=0-13159",
        "User-Agent": "Mozilla/5.0 (KoraZero Xtream Probe)",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return { response, bytes: new Uint8Array() };
    const reader = response.body.getReader();
    const { value } = await reader.read();
    try {
      await reader.cancel();
    } catch {
      /* noop */
    }
    return { response, bytes: value || new Uint8Array() };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function probeMediaUrl(url, kind, timeoutMs = 8000) {
  try {
    const first = await fetchProbeBytes(
      url,
      kind === "hls" ? "application/vnd.apple.mpegurl,*/*" : "video/mp2t,*/*",
      timeoutMs,
    );
    if (!first.response.ok || !first.bytes.length) {
      return { ok: false, status: first.response.status, protocol: kind };
    }
    if (kind === "hls") {
      const text = textDecoder.decode(first.bytes).trimStart();
      if (!text.startsWith("#EXTM3U")) {
        return { ok: false, status: first.response.status, protocol: kind };
      }
      const mediaLine = text.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith("#"));
      if (!mediaLine)
        return { ok: true, status: first.response.status, protocol: kind, mobileCompatible: null };
      const segmentUrl = new URL(mediaLine.trim(), url).toString();
      const segment = await fetchProbeBytes(segmentUrl, "video/mp2t,*/*", timeoutMs);
      const codecs = inspectMpegTsCodecs(segment.bytes);
      return {
        ok: segment.response.ok && segment.bytes.length > 0,
        status: segment.response.status,
        protocol: kind,
        bytes: segment.bytes.length,
        codecs,
        mobileCompatible: codecs.mobileCompatible,
      };
    }
    const codecs = inspectMpegTsCodecs(first.bytes);
    const sync = first.bytes[0] === 0x47 || (first.bytes.length > 188 && first.bytes[188] === 0x47);
    return {
      ok: sync,
      status: first.response.status,
      protocol: kind,
      bytes: first.bytes.length,
      codecs,
      mobileCompatible: codecs.mobileCompatible,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      protocol: kind,
      error: error.name === "AbortError" ? "timeout" : String(error.message || error),
    };
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
