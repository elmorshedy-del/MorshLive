/**
 * morshlive worker — static site + worldkoora vip proxy without preroll ads.
 *
 * /wk/albaplayer/vip1|vip2/ fetches vip.worldkoora.com server-side, strips
 * preroll + embed-guard scripts, rewrites stream URLs through /wk/hls (spoofed
 * Referer), and serves player HTML from korazero.com so the iframe stays clean.
 *
 * STREAM-HOST TRUST IS BY PROVENANCE, NOT A STATIC ALLOWLIST.
 * Every stream URL the worker rewrites out of an upstream worldkoora page or
 * manifest is stamped with an HMAC signature (env.STREAM_SIGNING_SECRET).
 * /wk/hls proxies any host whose ?u= value carries a valid signature — so when
 * worldkoora rotates its CDN to a brand-new hostname mid-tournament, playback
 * keeps working with zero code changes and zero redeploys. Un-signed ?u= values
 * stay restricted to ALLOWED_STREAM_HOST below, so the worker never becomes an
 * open proxy for third parties.
 *
 * REQUIRED CONFIG: set the signing secret once per environment, otherwise the
 * worker falls back to the static allowlist and will black out on the next host
 * rotation (the very bug this design removes):
 *   npx wrangler secret put STREAM_SIGNING_SECRET
 */
const WORLDKOORA = "https://vip.worldkoora.com";
const VIP_RE = /^\/wk\/albaplayer\/(vip[12])\/?$/i;
const HLS_RE = /^\/wk\/(?:hls|stream\.m3u8)$/i;

// dlhd (daddylive) 24/7 source — fully isolated from the worldkoora /wk/ path.
const DLHD_BASE = "https://dlhd.pk";
const DL_EMBED_RE = /^\/dl\/(\d{1,6})\/?$/;  // /dl/{channelId} -> clean player page
const DL_HLS_RE = /^\/dl\/hls$/i;            // signed HLS proxy for dlhd streams

// Fallback trust for UN-signed ?u= values only (direct hits / legacy links).
// Signed URLs minted by this worker bypass this list entirely, so it no longer
// needs to be edited every time worldkoora rotates its CDN host.
const ALLOWED_STREAM_HOST =
  /(^|\.)((heinzromanigi|teworld|smarop|golatooa)\.[a-z0-9.-]+|(cdn[0-9]?\.)?heinzromanigi1\.xyz|za\.teworld\.online|we\.smarop\.store|mashy\.[a-z0-9.-]+)$/i;

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

/* ----------------------------------------------- Provenance signing (HMAC) */
// Cache imported CryptoKeys so we don't re-import per request.
const _keyCache = new Map();
async function hmacKey(secret) {
  let key = _keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    _keyCache.set(secret, key);
  }
  return key;
}

function b64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Sign the EXACT target URL string that will travel in ?u=. Empty when no
// secret is configured (callers then fall back to the static allowlist).
// Signatures are deterministic for (target, secret), so memoize them: live HLS
// manifests refresh every few seconds with the same segment URLs, and every
// segment request re-verifies, so this avoids re-running HMAC on hot paths and
// keeps us well under the Worker CPU limit. Bounded so memory can't grow forever.
const _sigCache = new Map();
async function signTarget(target, secret) {
  if (!secret) return "";
  const cacheKey = secret + "\0" + target;
  let sig = _sigCache.get(cacheKey);
  if (sig === undefined) {
    const key = await hmacKey(secret);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(target));
    sig = b64url(mac);
    if (_sigCache.size >= 1000) _sigCache.clear();
    _sigCache.set(cacheKey, sig);
  }
  return sig;
}

async function verifyTarget(target, sig, secret) {
  if (!secret || !sig) return false;
  const expected = await signTarget(target, secret);
  if (!expected || expected.length !== sig.length) return false;
  let diff = 0; // length-equal constant-time-ish compare
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// Promise-aware String.prototype.replace for the rewrite passes (signing is async).
async function asyncReplaceAll(input, regex, asyncFn) {
  const parts = [];
  let last = 0;
  for (const m of String(input).matchAll(regex)) {
    parts.push(input.slice(last, m.index));
    parts.push(await asyncFn(m));
    last = m.index + m[0].length;
  }
  parts.push(input.slice(last));
  return parts.join("");
}

function stripBlockedScripts(html) {
  return String(html || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (block) => {
    if (/agl006\.host|aplr-fxd-bnr|cvt-s\d*\.agl/i.test(block)) return "";
    if (/AplrDevprotocol|ConsoleBan\.init|ConsoleBan\.prototype/i.test(block)) return "";
    return block;
  });
}

function hlsProxyUrl(target, origin, sig, basePath) {
  const path = basePath || "/wk/stream.m3u8";
  const signature = sig ? `&sig=${encodeURIComponent(sig)}` : "";
  return `${origin}${path}?u=${encodeURIComponent(target)}${signature}`;
}

function resolveStreamUrl(relative, base) {
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

function isAllowedStreamUrl(url) {
  try {
    const host = new URL(url).hostname;
    return ALLOWED_STREAM_HOST.test(host);
  } catch {
    return false;
  }
}

// Should this URL, found inside trusted upstream content, be routed through our
// signed proxy? Yes for any external http(s) host (provenance trust); no for
// non-http schemes or URLs already pointing back at us.
function shouldProxyStream(url, origin) {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return new URL(url).origin !== origin;
  } catch {
    return false;
  }
}

function segmentContentType(target) {
  if (/\.ts(?:\?|$)/i.test(target)) return "video/mp2t";
  if (/\.m3u8(?:\?|$)/i.test(target)) return "application/vnd.apple.mpegurl";
  return null;
}

// Rewrite every stream URL a manifest references into a signed /wk proxy URL.
// The manifest was fetched from a host we already trusted (signed or allowlisted),
// so its child variants/segments inherit that trust regardless of their hostname.
async function rewriteM3u8(body, manifestUrl, origin, secret, basePath) {
  const base = manifestUrl.replace(/[^/]+$/, "");
  const lines = body.split("\n");
  const rewritten = await Promise.all(
    lines.map(async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return asyncReplaceAll(line, /URI="([^"]+)"/gi, async (m) => {
          const abs = resolveStreamUrl(m[1], manifestUrl);
          if (!shouldProxyStream(abs, origin)) return m[0];
          const sig = await signTarget(abs, secret);
          return `URI="${hlsProxyUrl(abs, origin, sig, basePath)}"`;
        });
      }
      const abs = resolveStreamUrl(trimmed, base || manifestUrl);
      if (!shouldProxyStream(abs, origin)) return trimmed;
      const sig = await signTarget(abs, secret);
      return hlsProxyUrl(abs, origin, sig, basePath);
    })
  );
  return rewritten.join("\n");
}

async function rewriteStreamUrlsInHtml(html, origin, secret) {
  let out = await asyncReplaceAll(
    html,
    /(<(?:source|video)\b[^>]*\ssrc=)(["'])(https?:\/\/[^"']+)\2/gi,
    async (m) => {
      const [whole, pre, q, url] = m;
      if (!shouldProxyStream(url, origin)) return whole;
      const sig = await signTarget(url, secret);
      return `${pre}${q}${hlsProxyUrl(url, origin, sig)}${q}`;
    }
  );
  out = await asyncReplaceAll(out, /AlbaPlayerControl\('([A-Za-z0-9+/=]*)','([^']+)'\)/g, async (m) => {
    const [whole, b64, player] = m;
    if (!b64) return whole;
    try {
      const raw = atob(b64);
      if (!shouldProxyStream(raw, origin)) return whole;
      const sig = await signTarget(raw, secret);
      const proxied = hlsProxyUrl(raw, origin, sig);
      return `AlbaPlayerControl('${btoa(proxied)}','${player}')`;
    } catch {
      return whole;
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

async function proxyHls(request, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const target = incoming.searchParams.get("u");
  const sig = incoming.searchParams.get("sig");
  const secret = env && env.STREAM_SIGNING_SECRET;
  // Trust a target if we signed it (provenance — any host) OR it matches the
  // static allowlist (un-signed legacy/direct access).
  const trusted = target && ((await verifyTarget(target, sig, secret)) || isAllowedStreamUrl(target));
  if (!trusted) {
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
      const rewritten = await rewriteM3u8(text, target, origin, secret);
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
    const secret = env && env.STREAM_SIGNING_SECRET;
    return new Response(await cleanWorldkooraHtml(html, slot, origin, secret), {
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

/* ----------------------------------------------- dlhd (daddylive) 24/7 source
 * Isolated mirror of the worldkoora flow. dlhd embeds the real stream as a
 * base64 source inside a rotating /premiumtv/ player page; we resolve it
 * server-side and play it through the SAME signed proxy (/dl/hls), so the
 * rotating CDN host needs no allowlist. The dlhd CDN rejects requests carrying
 * an Origin header (400) and needs no Referer — its m3u8 URLs are
 * self-authorizing (md5/expires) tokens, so we send neither. */
async function resolveDlStream(id) {
  const headers = { "User-Agent": "Mozilla/5.0", Referer: `${DLHD_BASE}/` };
  try {
    const sTxt = await (await fetch(`${DLHD_BASE}/stream/stream-${id}.php`, { headers })).text();
    const embed = sTxt.match(/<iframe[^>]+src="([^"]+\/premiumtv\/[^"]+)"/i);
    if (!embed) return null;
    const eTxt = await (await fetch(embed[1], { headers })).text();
    const b64 = eTxt.match(/atob\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)/);
    if (!b64) return null;
    const url = atob(b64[1]);
    return /^https?:\/\/[^\s]+\.m3u8/i.test(url) ? url : null;
  } catch {
    return null;
  }
}

function dlPlayerHtml(src, id) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>beIN ${id}</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#v{width:100vw;height:100vh;background:#000;object-fit:contain}</style>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
</head><body>
<video id="v" controls autoplay muted playsinline></video>
<script>
(function(){
  var v=document.getElementById('v'), src=${JSON.stringify(src)};
  if(v.canPlayType('application/vnd.apple.mpegurl')){ v.src=src; }
  else if(window.Hls&&window.Hls.isSupported()){
    var h=new Hls({maxBufferLength:30,liveSyncDurationCount:3,manifestLoadingMaxRetry:4});
    h.loadSource(src); h.attachMedia(v);
    h.on(Hls.Events.ERROR,function(_e,d){ if(d&&d.fatal&&d.type==='networkError'){ setTimeout(function(){h.loadSource(src);},2000); } });
  } else { v.src=src; }
  var p=v.play&&v.play(); if(p&&p.catch)p.catch(function(){});
})();
</script>
</body></html>`;
}

async function proxyDlEmbed(request, id, env) {
  const origin = new URL(request.url).origin;
  const secret = env && env.STREAM_SIGNING_SECRET;
  const htmlHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-KZ-Proxy": "dlhd-embed" };
  const m3u8 = await resolveDlStream(id);
  if (!m3u8) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh;text-align:center"><div>البث غير متاح حالياً — أعد المحاولة<br><small>channel ${id}</small></div></body>`,
      { status: 200, headers: htmlHeaders }
    );
  }
  const sig = await signTarget(m3u8, secret);
  const src = hlsProxyUrl(m3u8, origin, sig, "/dl/hls");
  return new Response(dlPlayerHtml(src, id), { status: 200, headers: htmlHeaders });
}

async function proxyDlHls(request, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const target = incoming.searchParams.get("u");
  const sig = incoming.searchParams.get("sig");
  const secret = env && env.STREAM_SIGNING_SECRET;
  // dlhd trust is purely by provenance signature (no host allowlist).
  if (!target || !(await verifyTarget(target, sig, secret))) {
    return new Response("Forbidden stream host", { status: 403 });
  }
  const isHead = request.method === "HEAD";
  try {
    const res = await fetch(target, {
      method: request.method,
      headers: { "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0", Accept: "*/*" },
      redirect: "follow",
    });
    if (!res.ok) {
      return new Response(isHead ? null : `Upstream error ${res.status}`, { status: res.status });
    }
    const type = (res.headers.get("Content-Type") || "").toLowerCase();
    const isManifest = type.includes("mpegurl") || type.includes("m3u8") || /\.m3u8(?:\?|$)/i.test(target);
    if (isManifest) {
      const manifestHeaders = {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "X-KZ-Proxy": "dlhd-manifest",
      };
      if (isHead) return new Response(null, { status: 200, headers: manifestHeaders });
      const text = await res.text();
      const rewritten = await rewriteM3u8(text, target, origin, secret, "/dl/hls");
      return new Response(rewritten, { status: 200, headers: manifestHeaders });
    }
    const headers = {
      "Content-Type": segmentContentType(target) || res.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": "public, max-age=2",
      "Access-Control-Allow-Origin": "*",
      "X-KZ-Proxy": "dlhd-segment",
    };
    return new Response(isHead ? null : res.body, { status: res.status, headers });
  } catch {
    return new Response(isHead ? null : "Upstream unavailable", { status: 502 });
  }
}

/* ----------------------------------------------- sir / siiir tv (foozlive) 24/7
 * EXPERIMENTAL second source (تجريبي). Same isolated, signed-proxy pattern as the
 * dlhd flow above. The upstream player (912acsss8af382.shootny.com/playerv5.php)
 * hides its channel list in a base64+XOR blob and signs every CDN request with an
 * md5 token built from a per-page secret. We decode that config server-side, mint
 * the signed foozlive master URL, and play it through /sir/hls. Two quirks the
 * proxy handles that the worldkoora/dlhd sources don't:
 *   1. foozlive's CDN gates on Referer/Origin = the shootny player host.
 *   2. AR feeds disguise each TS segment as a JPEG (real video is appended after
 *      the JPEG's FFD9 EOI); we lock onto the MPEG-TS sync byte and strip the
 *      preamble so hls.js receives clean video/mp2t. FR/EN are already plain TS.
 * The channel paths (6f86bdcsedfssins…) are fixed 24/7 slots, so the ?match= id
 * only feeds the score strip — any value yields the same stream config. */
const SIR_PLAYER = "https://912acsss8af382.shootny.com/playerv5.php";
const SIR_KEY = "9f39972b67d6ce22189507d008acwc26"; // pragma: allowlist secret
const SIR_REFERER = "https://912acsss8af382.shootny.com/";
const SIR_ORIGIN = "https://912acsss8af382.shootny.com";
const SIR_XOR = "k9f2m7x1";
const SIR_PROBE_MATCH = "4748109"; // arbitrary — config is global to all matches
const SIR_EMBED_RE = /^\/sir\/(ar1|ar2|fr|en)\/?$/i;
const SIR_HLS_RE = /^\/sir\/hls$/i;
// slug -> stable substring of the tab path (survives label/order changes upstream)
const SIR_TAB_KEY = { ar1: "d0x1", ar2: "d0x2", fr: "xfr", en: "xen" };
const SIR_LABELS = { ar1: "AR 1", ar2: "AR 2", fr: "FR", en: "EN" };

// md5 — needed for the foozlive token; crypto.subtle has no md5. (blueimp-style)
function md5(s) {
  function L(k, d) { return (k << d) | (k >>> (32 - d)); }
  function K(G, k) { var I, d, F, H, x; F = (G & 2147483648); H = (k & 2147483648); I = (G & 1073741824); d = (k & 1073741824); x = (G & 1073741823) + (k & 1073741823); if (I & d) return (x ^ 2147483648 ^ F ^ H); if (I | d) { if (x & 1073741824) return (x ^ 3221225472 ^ F ^ H); else return (x ^ 1073741824 ^ F ^ H); } else return (x ^ F ^ H); }
  function r(d, F, k) { return (d & F) | ((~d) & k); }
  function q(d, F, k) { return (d & k) | (F & (~k)); }
  function p(d, F, k) { return (d ^ F ^ k); }
  function nF(d, F, k) { return (F ^ (d | (~k))); }
  function u(G, F, a, Z, k, H, I) { G = K(G, K(K(r(F, a, Z), k), I)); return K(L(G, H), F); }
  function f(G, F, a, Z, k, H, I) { G = K(G, K(K(q(F, a, Z), k), I)); return K(L(G, H), F); }
  function D(G, F, a, Z, k, H, I) { G = K(G, K(K(p(F, a, Z), k), I)); return K(L(G, H), F); }
  function t(G, F, a, Z, k, H, I) { G = K(G, K(K(nF(F, a, Z), k), I)); return K(L(G, H), F); }
  function e(G) { var Z, F = "", d = "", k; for (k = 0; k <= 3; k++) { Z = (G >>> (k * 8)) & 255; d = "0" + Z.toString(16); F = F + d.substr(d.length - 2, 2); } return F; }
  function X(k) { k = k.replace(/\r\n/g, "\n"); var d = ""; for (var F = 0; F < k.length; F++) { var G = k.charCodeAt(F); if (G < 128) { d += String.fromCharCode(G); } else if ((G > 127) && (G < 2048)) { d += String.fromCharCode((G >> 6) | 192); d += String.fromCharCode((G & 63) | 128); } else { d += String.fromCharCode((G >> 12) | 224); d += String.fromCharCode(((G >> 6) & 63) | 128); d += String.fromCharCode((G & 63) | 128); } } return d; }
  function B(k) { var F, d = k.length, G = d + 8, I = (G - (G % 64)) / 64, H = (I + 1) * 16, a = Array(H - 1), Z = 0, x = 0; while (x < d) { F = (x - (x % 4)) / 4; Z = (x % 4) * 8; a[F] = (a[F] | (k.charCodeAt(x) << Z)); x++; } F = (x - (x % 4)) / 4; Z = (x % 4) * 8; a[F] = a[F] | (128 << Z); a[H - 2] = d << 3; a[H - 1] = d >>> 29; return a; }
  var C, P, h, E, v, g, Y, G, W, o, S = 7, Q = 12, N = 17, M = 22, A = 5, U = 9, T = 14, R = 20, J = 4, V = 11, y = 16, Za = 23, w = 6, c = 10, M2 = 15, b = 21;
  s = X(s); C = B(s); Y = 1732584193; G = 4023233417; W = 2562383102; o = 271733878;
  for (P = 0; P < C.length; P += 16) {
    h = Y; E = G; v = W; g = o;
    Y = u(Y, G, W, o, C[P + 0], S, 3614090360); o = u(o, Y, G, W, C[P + 1], Q, 3905402710); W = u(W, o, Y, G, C[P + 2], N, 606105819); G = u(G, W, o, Y, C[P + 3], M, 3250441966);
    Y = u(Y, G, W, o, C[P + 4], S, 4118548399); o = u(o, Y, G, W, C[P + 5], Q, 1200080426); W = u(W, o, Y, G, C[P + 6], N, 2821735955); G = u(G, W, o, Y, C[P + 7], M, 4249261313);
    Y = u(Y, G, W, o, C[P + 8], S, 1770035416); o = u(o, Y, G, W, C[P + 9], Q, 2336552879); W = u(W, o, Y, G, C[P + 10], N, 4294925233); G = u(G, W, o, Y, C[P + 11], M, 2304563134);
    Y = u(Y, G, W, o, C[P + 12], S, 1804603682); o = u(o, Y, G, W, C[P + 13], Q, 4254626195); W = u(W, o, Y, G, C[P + 14], N, 2792965006); G = u(G, W, o, Y, C[P + 15], M, 1236535329);
    Y = f(Y, G, W, o, C[P + 1], A, 4129170786); o = f(o, Y, G, W, C[P + 6], U, 3225465664); W = f(W, o, Y, G, C[P + 11], T, 643717713); G = f(G, W, o, Y, C[P + 0], R, 3921069994);
    Y = f(Y, G, W, o, C[P + 5], A, 3593408605); o = f(o, Y, G, W, C[P + 10], U, 38016083); W = f(W, o, Y, G, C[P + 15], T, 3634488961); G = f(G, W, o, Y, C[P + 4], R, 3889429448);
    Y = f(Y, G, W, o, C[P + 9], A, 568446438); o = f(o, Y, G, W, C[P + 14], U, 3275163606); W = f(W, o, Y, G, C[P + 3], T, 4107603335); G = f(G, W, o, Y, C[P + 8], R, 1163531501);
    Y = f(Y, G, W, o, C[P + 13], A, 2850285829); o = f(o, Y, G, W, C[P + 2], U, 4243563512); W = f(W, o, Y, G, C[P + 7], T, 1735328473); G = f(G, W, o, Y, C[P + 12], R, 2368359562);
    Y = D(Y, G, W, o, C[P + 5], J, 4294588738); o = D(o, Y, G, W, C[P + 8], V, 2272392833); W = D(W, o, Y, G, C[P + 11], y, 1839030562); G = D(G, W, o, Y, C[P + 14], Za, 4259657740);
    Y = D(Y, G, W, o, C[P + 1], J, 2763975236); o = D(o, Y, G, W, C[P + 4], V, 1272893353); W = D(W, o, Y, G, C[P + 7], y, 4139469664); G = D(G, W, o, Y, C[P + 10], Za, 3200236656);
    Y = D(Y, G, W, o, C[P + 13], J, 681279174); o = D(o, Y, G, W, C[P + 0], V, 3936430074); W = D(W, o, Y, G, C[P + 3], y, 3572445317); G = D(G, W, o, Y, C[P + 6], Za, 76029189);
    Y = D(Y, G, W, o, C[P + 9], J, 3654602809); o = D(o, Y, G, W, C[P + 12], V, 3873151461); W = D(W, o, Y, G, C[P + 15], y, 530742520); G = D(G, W, o, Y, C[P + 2], Za, 3299628645);
    Y = t(Y, G, W, o, C[P + 0], w, 4096336452); o = t(o, Y, G, W, C[P + 7], c, 1126891415); W = t(W, o, Y, G, C[P + 14], M2, 2878612391); G = t(G, W, o, Y, C[P + 5], b, 4237533241);
    Y = t(Y, G, W, o, C[P + 12], w, 1700485571); o = t(o, Y, G, W, C[P + 3], c, 2399980690); W = t(W, o, Y, G, C[P + 10], M2, 4293915773); G = t(G, W, o, Y, C[P + 1], b, 2240044497);
    Y = t(Y, G, W, o, C[P + 8], w, 1873313359); o = t(o, Y, G, W, C[P + 15], c, 4264355552); W = t(W, o, Y, G, C[P + 6], M2, 2734768916); G = t(G, W, o, Y, C[P + 13], b, 1309151649);
    Y = t(Y, G, W, o, C[P + 4], w, 4149444226); o = t(o, Y, G, W, C[P + 11], c, 3174756917); W = t(W, o, Y, G, C[P + 2], M2, 718787259); G = t(G, W, o, Y, C[P + 9], b, 3951481745);
    Y = K(Y, h); G = K(G, E); W = K(W, v); o = K(o, g);
  }
  return (e(Y) + e(G) + e(W) + e(o)).toLowerCase();
}

function sirRand(n, set) { var s = ""; for (var i = 0; i < n; i++) s += set[Math.floor(Math.random() * set.length)]; return s; }
function sirB36(n) { var d = "0123456789abcdefghijklmnopqrstuvwxyz", s = ""; while (n) { s = d[n % 36] + s; n = Math.floor(n / 36); } return s || "0"; }

// tab path -> real CDN path (matches the upstream player's rewrite rules)
function sirRewritePath(path) {
  let p = path.startsWith("/") ? path.slice(1) : path;
  let q = p.startsWith("kooora/") ? p.slice(7) : p;
  if (q.startsWith("kc/")) return "kooora/" + q.slice(3) + "_kc";
  if (q.startsWith("sc/")) return "kooora/" + q.slice(3) + "_sc";
  if (q.startsWith("mx/")) return "kooora/" + q.slice(3) + "_mux";
  if (q.startsWith("loco/")) return "kooora/" + q.slice(5) + "_loco";
  return p;
}

// foozlive request signing: token = md5(realPath + sid + secret)
function sirSign(domain, real, secret) {
  const sid = sirRand(32, "0123456789abcdef");
  const ts = Math.floor(Date.now() / 1000);
  const token = md5(real + sid + secret);
  const nonce = sirRand(4, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") + sirB36(ts % 100000);
  return `${domain}${real}?ts=${ts}&nonce=${nonce}&token=${token}&sid=${sid}`;
}

// decode the playerv5 config (base64 -> XOR k9f2m7x1) and the page token secret
function sirDecodeConfig(html) {
  const m = html.match(/var _0x="([^"]+)"/);
  const e = html.match(/var _e="([^"]+)"/);
  if (!m || !e) return null;
  // Upstream HTML shape (or the base64 payloads themselves) can change without
  // notice; atob()/JSON.parse() throwing here must degrade to "unavailable",
  // not a 500 from the worker.
  try {
    const bin = atob(m[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ SIR_XOR.charCodeAt(i % SIR_XOR.length);
    const cfg = JSON.parse(new TextDecoder("utf-8").decode(bytes));
    return { cfg, secret: atob(e[1]) };
  } catch {
    return null;
  }
}

// Resolve a channel slug to a freshly-signed foozlive master playlist URL.
async function resolveSirMaster(slug) {
  let html;
  try {
    const res = await fetch(`${SIR_PLAYER}?match=${SIR_PROBE_MATCH}&key=${SIR_KEY}`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html", Referer: "https://siiiiiiir.tv/" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch { return null; }
  const decoded = sirDecodeConfig(html);
  if (!decoded || !decoded.cfg || !Array.isArray(decoded.cfg.tabs)) return null;
  const key = SIR_TAB_KEY[slug];
  const tab = decoded.cfg.tabs.find((t) => t.type === "regular" && t.path && t.path.includes(key));
  if (!tab) return null;
  const domains = (decoded.cfg.activeDomains && decoded.cfg.activeDomains.length)
    ? decoded.cfg.activeDomains : ["https://1rxolmirvosixpyfy.foozlive.co/"];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  const cleanDomain = domain.endsWith("/") ? domain : domain + "/";
  return sirSign(cleanDomain, sirRewritePath(tab.path), decoded.secret);
}

// Un-signed fallback trust (when STREAM_SIGNING_SECRET isn't configured): the only
// hosts SIR manifests ever reference are foozlive (manifests) and cloudfront (segments).
function isSirAllowedHost(url) {
  try {
    const h = new URL(url).hostname;
    return /(^|\.)foozlive\.co$/i.test(h) || /(^|\.)cloudfront\.net$/i.test(h);
  } catch { return false; }
}

// Strip the JPEG decoy preamble: AR segments prepend a full JPEG, then real MPEG-TS.
// Lock onto 4 consecutive TS sync bytes (188-spaced) and return from there. FR/EN
// segments are already TS (first byte 0x47) and pass straight through.
function sirStripToTs(buf) {
  if (buf.length && buf[0] === 0x47) return buf;
  const max = Math.min(buf.length - 564, 300000);
  for (let i = 0; i < max; i++) {
    if (buf[i] === 0x47 && buf[i + 188] === 0x47 && buf[i + 376] === 0x47 && buf[i + 564] === 0x47) {
      return buf.subarray(i);
    }
  }
  return buf;
}

function sirPlayerHtml(src, slug) {
  const tabs = ["ar1", "ar2", "fr", "en"]
    .map((s) => `<a href="/sir/${s}"${s === slug ? ' class="on"' : ""}>${SIR_LABELS[s]}</a>`)
    .join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SIR ${SIR_LABELS[slug] || slug} — تجريبي</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:system-ui,sans-serif}
#bar{position:fixed;top:0;left:0;right:0;display:flex;gap:4px;padding:6px;background:rgba(10,12,24,.72);z-index:5;backdrop-filter:blur(6px)}
#bar a{flex:1;text-align:center;padding:7px 4px;border-radius:8px;color:#cbd5e1;text-decoration:none;font-size:13px;font-weight:700;background:rgba(255,255,255,.05)}
#bar a.on{background:linear-gradient(135deg,#2e0d5e,#421480);color:#fff}
#v{width:100vw;height:100vh;background:#000;object-fit:contain}</style>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
</head><body>
<div id="bar">${tabs}</div>
<video id="v" controls autoplay muted playsinline></video>
<script>
(function(){
  var v=document.getElementById('v'), src=${JSON.stringify(src)};
  function start(){
    if(v.canPlayType('application/vnd.apple.mpegurl')){ v.src=src; }
    else if(window.Hls&&window.Hls.isSupported()){
      var h=new Hls({maxBufferLength:30,liveSyncDurationCount:3,manifestLoadingMaxRetry:6,fragLoadingMaxRetry:6});
      h.loadSource(src); h.attachMedia(v);
      h.on(Hls.Events.ERROR,function(_e,d){ if(d&&d.fatal){ if(d.type==='networkError'){ setTimeout(function(){try{h.startLoad();}catch(e){h.loadSource(src);}},2000);} else if(d.type==='mediaError'){ try{h.recoverMediaError();}catch(e){} } } });
    } else { v.src=src; }
    var p=v.play&&v.play(); if(p&&p.catch)p.catch(function(){});
  }
  start();
})();
</script>
</body></html>`;
}

async function proxySirEmbed(request, slug, env) {
  const origin = new URL(request.url).origin;
  const secret = env && env.STREAM_SIGNING_SECRET;
  const htmlHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-KZ-Proxy": "sir-embed" };
  const master = await resolveSirMaster(slug);
  if (!master) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh;text-align:center"><div>البث غير متاح حالياً — أعد المحاولة<br><small>SIR ${SIR_LABELS[slug] || slug}</small></div></body>`,
      { status: 200, headers: htmlHeaders }
    );
  }
  const sig = await signTarget(master, secret);
  const src = hlsProxyUrl(master, origin, sig, "/sir/hls");
  return new Response(sirPlayerHtml(src, slug), { status: 200, headers: htmlHeaders });
}

async function proxySirHls(request, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const target = incoming.searchParams.get("u");
  const sig = incoming.searchParams.get("sig");
  const secret = env && env.STREAM_SIGNING_SECRET;
  // Trust by provenance signature (any host) OR the SIR host fallback (un-signed).
  const trusted = target && ((await verifyTarget(target, sig, secret)) || isSirAllowedHost(target));
  if (!trusted) {
    return new Response("Forbidden stream host", { status: 403 });
  }
  const isHead = request.method === "HEAD";
  let host = "";
  try { host = new URL(target).hostname; } catch { return new Response("Bad target", { status: 400 }); }
  const headers = {
    "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
    Accept: "*/*",
    Referer: SIR_REFERER,
  };
  if (/(^|\.)foozlive\.co$/i.test(host)) headers.Origin = SIR_ORIGIN; // foozlive gates on Origin; cloudfront doesn't need it
  try {
    const res = await fetch(target, { method: request.method, headers, redirect: "follow" });
    if (!res.ok) {
      return new Response(isHead ? null : `Upstream error ${res.status}`, { status: res.status });
    }
    const type = (res.headers.get("Content-Type") || "").toLowerCase();
    const isManifest = type.includes("mpegurl") || type.includes("m3u8") || /\.m3u8(?:\?|$)/i.test(target);
    if (isManifest) {
      const manifestHeaders = {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "X-KZ-Proxy": "sir-manifest",
      };
      if (isHead) return new Response(null, { status: 200, headers: manifestHeaders });
      const text = await res.text();
      const rewritten = await rewriteM3u8(text, target, origin, secret, "/sir/hls");
      return new Response(rewritten, { status: 200, headers: manifestHeaders });
    }
    // Segment: strip any JPEG-decoy preamble, serve clean MPEG-TS.
    const segHeaders = {
      "Content-Type": "video/mp2t",
      "Cache-Control": "public, max-age=2",
      "Access-Control-Allow-Origin": "*",
      "X-KZ-Proxy": "sir-segment",
    };
    if (isHead) return new Response(null, { status: 200, headers: segHeaders });
    const buf = new Uint8Array(await res.arrayBuffer());
    return new Response(sirStripToTs(buf), { status: 200, headers: segHeaders });
  } catch {
    return new Response(isHead ? null : "Upstream unavailable", { status: 502 });
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
    const dl = url.pathname.match(DL_EMBED_RE);
    if (dl && (method === "GET" || method === "HEAD")) {
      return proxyDlEmbed(request, dl[1], env);
    }
    if (DL_HLS_RE.test(url.pathname) && (method === "GET" || method === "HEAD" || method === "OPTIONS")) {
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
      return proxyDlHls(request, env);
    }
    const sir = url.pathname.match(SIR_EMBED_RE);
    if (sir && (method === "GET" || method === "HEAD")) {
      return proxySirEmbed(request, sir[1].toLowerCase(), env);
    }
    if (SIR_HLS_RE.test(url.pathname) && (method === "GET" || method === "HEAD" || method === "OPTIONS")) {
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
      return proxySirHls(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
