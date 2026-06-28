/**
 * morshlive worker — static site + worldkoora vip proxy without preroll ads.
 *
 * /wk/albaplayer/vip1|vip2/ fetches vip.worldkoora.com server-side, strips
 * preroll + embed-guard scripts, rewrites stream URLs through /wk/hls (spoofed
 * Referer), and serves player HTML from korazero.com so the iframe stays clean.
 *
 * Stream-URL authorization:
 *   The worldkoora CDN host rotates often, which used to break playback whenever
 *   a new host wasn't in ALLOWED_STREAM_HOST. To avoid that, /wk/hls now accepts
 *   any URL the worker itself signed (HMAC, keyed by env.STREAM_PROXY_SECRET) —
 *   the worker only ever signs URLs it extracted from the worldkoora player, so
 *   it vouches for them without a hand-maintained host list. When no secret is
 *   configured it falls back to the static ALLOWED_STREAM_HOST allowlist, so the
 *   behaviour is unchanged until you set the secret:
 *     npx wrangler secret put STREAM_PROXY_SECRET
 */
const WORLDKOORA = "https://vip.worldkoora.com";
const VIP_RE = /^\/wk\/albaplayer\/(vip[12])\/?$/i;
const HLS_RE = /^\/wk\/(?:hls|stream\.m3u8)$/i;

// Fallback allowlist, used only when STREAM_PROXY_SECRET is not configured.
const ALLOWED_STREAM_HOST =
  /(^|\.)((heinzromanigi|teworld|smarop|golatooa)\.[a-z0-9.-]+|(cdn[0-9]?\.)?heinzromanigi1\.xyz|za\.teworld\.online|we\.smarop\.store|mashy\.[a-z0-9.-]+)$/i;

// Defense-in-depth: never proxy to internal / non-public hosts, even with a
// valid signature.
const PRIVATE_HOST_RE =
  /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?fe80:|\[?fc00:|\[?fd)/i;

const HIDE_OVERLAY_STYLE = `<style id="kz-no-ads">
.aplr-fxd-bnr,#aplr-fixedban,
[class^="agl-"],[class*=" agl-"],[id^="agl-"],
.aplr-ad,.aplr-preroll,.video-ad,.vjs-ad,.ima-ad-container,
.aplr-embed-holder,.aplr-embed-visible,.aplr-site-name{display:none!important;visibility:hidden!important;pointer-events:none!important}
</style>`;

const EMBED_SHIM = `<script id="kz-embed-shim">
(function(){
  window.AplrDevprotocol='0';
  window.AplrDevredirect='';
  window.AplrPopUp=function(){};
  function wrapPlayer(Orig){
    if(!Orig||Orig.__kzPatched)return Orig;
    function Patched(opts){
      opts=opts||{};
      var src=String(opts.source||'');
      if(src&&!opts.mimeType&&(/\\/wk\\/(hls|stream\\.m3u8)/.test(src)||/\\.m3u8/i.test(src.split('?')[0]))){
        opts.mimeType='application/vnd.apple.mpegurl';
      }
      return new Orig(opts);
    }
    Patched.__kzPatched=true;
    Patched.prototype=Orig.prototype;
    Object.assign(Patched,Orig);
    return Patched;
  }
  var clappr;
  Object.defineProperty(window,'Clappr',{
    configurable:true,
    enumerable:true,
    get:function(){return clappr;},
    set:function(v){
      clappr=v;
      if(v&&v.Player)v.Player=wrapPlayer(v.Player);
    }
  });
  if(window.Clappr&&window.Clappr.Player)window.Clappr.Player=wrapPlayer(window.Clappr.Player);
})();
</script>`;

const ENCODER = new TextEncoder();

function getSecret(env) {
  return (env && env.STREAM_PROXY_SECRET) || "";
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw", ENCODER.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, ENCODER.encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time-ish string compare so signature checks don't leak via timing.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function stripBlockedScripts(html) {
  return String(html || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (block) => {
    if (/agl006\.host|aplr-fxd-bnr|cvt-s\d*\.agl/i.test(block)) return "";
    if (/AplrDevprotocol|ConsoleBan\.init|ConsoleBan\.prototype/i.test(block)) return "";
    return block;
  });
}

// Build a /wk/stream.m3u8 proxy URL, signed with the secret when available so
// /wk/hls can authorize it without a host allowlist.
async function hlsProxyUrl(target, origin, secret) {
  let out = `${origin}/wk/stream.m3u8?u=${encodeURIComponent(target)}`;
  if (secret) out += `&s=${await hmacHex(secret, target)}`;
  return out;
}

function resolveStreamUrl(relative, base) {
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

function isPublicStreamUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return !PRIVATE_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

// A URL is proxyable when it's a public http(s) URL AND either the secret is set
// (we'll sign it) or its host is on the static allowlist.
function isProxyableStreamUrl(url, secret) {
  if (!isPublicStreamUrl(url)) return false;
  if (secret) return true;
  try {
    return ALLOWED_STREAM_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function segmentContentType(target) {
  if (/\.ts(?:\?|$)/i.test(target)) return "video/mp2t";
  if (/\.m3u8(?:\?|$)/i.test(target)) return "application/vnd.apple.mpegurl";
  return null;
}

async function replaceAsync(str, regex, asyncFn) {
  const matches = [];
  str.replace(regex, (...args) => {
    matches.push(asyncFn(...args));
    return "";
  });
  const resolved = await Promise.all(matches);
  let i = 0;
  return str.replace(regex, () => resolved[i++]);
}

async function rewriteM3u8(body, manifestUrl, origin, secret) {
  const base = manifestUrl.replace(/[^/]+$/, "");
  const lines = body.split("\n");
  const out = await Promise.all(lines.map(async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      return replaceAsync(line, /URI="([^"]+)"/gi, async (_, uri) => {
        const abs = resolveStreamUrl(uri, manifestUrl);
        return isProxyableStreamUrl(abs, secret)
          ? `URI="${await hlsProxyUrl(abs, origin, secret)}"`
          : `URI="${uri}"`;
      });
    }
    const abs = resolveStreamUrl(trimmed, base || manifestUrl);
    return isProxyableStreamUrl(abs, secret) ? hlsProxyUrl(abs, origin, secret) : trimmed;
  }));
  return out.join("\n");
}

async function rewriteStreamUrlsInHtml(html, origin, secret) {
  let out = await replaceAsync(
    html,
    /(<(?:source|video)\b[^>]*\ssrc=)(["'])(https?:\/\/[^"']+)\2/gi,
    async (m, pre, q, url) =>
      isProxyableStreamUrl(url, secret) ? `${pre}${q}${await hlsProxyUrl(url, origin, secret)}${q}` : m
  );
  out = await replaceAsync(out, /AlbaPlayerControl\('([A-Za-z0-9+/=]*)','([^']+)'\)/g, async (m, b64, player) => {
    if (!b64) return m;
    try {
      const raw = atob(b64);
      if (!/^https?:\/\//i.test(raw) || !isProxyableStreamUrl(raw, secret)) return m;
      const proxied = await hlsProxyUrl(raw, origin, secret);
      return `AlbaPlayerControl('${btoa(proxied)}','${player}')`;
    } catch {
      return m;
    }
  });
  return out;
}

async function cleanWorldkooraHtml(html, slot, origin, secret) {
  let out = stripBlockedScripts(html);
  out = await rewriteStreamUrlsInHtml(out, origin, secret);
  const headOpen = /<head[^>]*>/i;
  if (headOpen.test(out)) {
    out = out.replace(headOpen, (m) => m + EMBED_SHIM);
  } else {
    out = EMBED_SHIM + out;
  }
  const headClose = /<\/head>/i;
  if (headClose.test(out)) {
    out = out.replace(headClose, HIDE_OVERLAY_STYLE + "</head>");
  } else {
    out = HIDE_OVERLAY_STYLE + out;
  }
  return out;
}

async function isAuthorizedTarget(target, sig, secret) {
  if (!target || !isPublicStreamUrl(target)) return false;
  if (secret && sig) {
    try {
      if (safeEqual(sig, await hmacHex(secret, target))) return true;
    } catch {
      /* fall through to allowlist */
    }
  }
  try {
    return ALLOWED_STREAM_HOST.test(new URL(target).hostname);
  } catch {
    return false;
  }
}

async function proxyHls(request, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const target = incoming.searchParams.get("u");
  const sig = incoming.searchParams.get("s");
  if (!(await isAuthorizedTarget(target, sig, getSecret(env)))) {
    return new Response("Forbidden stream host", { status: 403 });
  }

  const referer = `${WORLDKOORA}/albaplayer/vip1/?serv=1`;
  const isHead = request.method === "HEAD";
  try {
    const res = await fetch(target, {
      method: request.method,
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        Accept: "*/*",
        Referer: referer,
        Origin: WORLDKOORA,
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return new Response(isHead ? null : `Upstream error ${res.status}`, { status: res.status });
    }

    const type = (res.headers.get("Content-Type") || "").toLowerCase();
    const isManifest = type.includes("mpegurl") || type.includes("m3u8") || target.includes(".m3u8");

    if (isManifest && !isHead) {
      const text = await res.text();
      const rewritten = await rewriteM3u8(text, target, origin, getSecret(env));
      return new Response(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "X-KZ-Proxy": "hls-manifest",
        },
      });
    }

    if (isManifest && isHead) {
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "X-KZ-Proxy": "hls-manifest",
        },
      });
    }

    const headers = {
      "Content-Type": segmentContentType(target) || res.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*",
      "X-KZ-Proxy": "hls-segment",
    };
    return new Response(isHead ? null : res.body, {
      status: res.status,
      headers,
    });
  } catch {
    return new Response(isHead ? null : "Upstream unavailable", { status: 502 });
  }
}

async function proxyVip(request, slot, env) {
  const incoming = new URL(request.url);
  const upstream = new URL(`${WORLDKOORA}/albaplayer/${slot}/`);
  upstream.search = incoming.search;
  const isHead = request.method === "HEAD";

  try {
    const res = await fetch(upstream.toString(), {
      method: request.method,
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml",
        Referer: `${WORLDKOORA}/`,
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return new Response(isHead ? null : `Upstream error ${res.status}`, { status: res.status });
    }

    if (isHead) {
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-KZ-Proxy": "worldkoora-vip",
        },
      });
    }

    const html = await res.text();
    const origin = new URL(request.url).origin;
    const cleaned = await cleanWorldkooraHtml(html, slot, origin, getSecret(env));
    return new Response(cleaned, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-KZ-Proxy": "worldkoora-vip",
      },
    });
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const vip = url.pathname.match(VIP_RE);
    if (vip && (method === "GET" || method === "HEAD")) {
      return proxyVip(request, vip[1].toLowerCase(), env);
    }
    if (HLS_RE.test(url.pathname) && (method === "GET" || method === "HEAD" || method === "OPTIONS")) {
      if (method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Max-Age": "86400",
          },
        });
      }
      return proxyHls(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
