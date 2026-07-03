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
// Worldkoora exposes "البث 1..N" as redundant servers for the SAME channel in a
// slot. We probe them in order so a dead/blank server this game falls over to a
// live one WITHIN the same slot (never to a different channel/slot).
const VIP_SERVER_COUNT = 3;

// dlhd (daddylive) 24/7 source — fully isolated from the worldkoora /wk/ path.
const DLHD_BASE = "https://dlhd.pk";
const DL_EMBED_RE = /^\/dl\/(\d{1,6})\/?$/;  // /dl/{channelId} -> clean player page
const DL_HLS_RE = /^\/dl\/hls$/i;            // signed HLS proxy for dlhd streams

// Stable, identity-fixed dlhd ids for the fixed beIN Sports Arabic channels.
// These are 24/7 mirrors of the SAME channel, added to the mirror pool as a
// resilient backup so a fully-dead worldkoora slot doesn't take the stream off.
const DLHD_CHANNEL_IDS = {
  "bein-sports-1": 91,
  "bein-sports-2": 92,
  "bein-sports-3": 93,
  "bein-sports-4": 94,
};

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

function hlsProxyUrl(target, origin, sig, basePath, ref) {
  const path = basePath || "/wk/stream.m3u8";
  const signature = sig ? `&sig=${encodeURIComponent(sig)}` : "";
  const refParam = ref ? `&ref=${encodeURIComponent(ref)}` : "";
  return `${origin}${path}?u=${encodeURIComponent(target)}${signature}${refParam}`;
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
async function rewriteM3u8(body, manifestUrl, origin, secret, basePath, ref) {
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
          return `URI="${hlsProxyUrl(abs, origin, sig, basePath, ref)}"`;
        });
      }
      const abs = resolveStreamUrl(trimmed, base || manifestUrl);
      if (!shouldProxyStream(abs, origin)) return trimmed;
      const sig = await signTarget(abs, secret);
      return hlsProxyUrl(abs, origin, sig, basePath, ref);
    })
  );
  return rewritten.join("\n");
}

function isHlsUrl(url) {
  return /^https?:\/\/[^\s"'<>`]+\.m3u8(?:[?#][^\s"'<>`]*)?$/i.test(url || "");
}

function uniqueItems(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function decodeBase64(value) {
  try {
    return atob(value);
  } catch {
    return "";
  }
}

function extractHlsCandidates(html) {
  const out = [];
  const text = String(html || "");
  for (const m of text.matchAll(/AlbaPlayerControl\('([A-Za-z0-9+/=]*)','([^']+)'\)/g)) {
    const source = decodeBase64(m[1]);
    if (isHlsUrl(source)) out.push({ source, player: m[2] || "clappr" });
  }
  for (const m of text.matchAll(/["'](https?:\/\/[^"']+\.m3u8(?:[?#][^"']*)?)["']/gi)) {
    if (isHlsUrl(m[1])) out.push({ source: m[1], player: "clappr" });
  }
  const seen = new Set();
  return out.filter((item) => {
    if (seen.has(item.source)) return false;
    seen.add(item.source);
    return true;
  });
}

function extractNestedPlayerUrls(html) {
  const urls = [];
  for (const m of String(html || "").matchAll(/<iframe\b[^>]*\bsrc=(["'])(https?:\/\/[^"']+)\1[^>]*>/gi)) {
    if (/\/albaplayer\//i.test(m[2])) urls.push(m[2]);
  }
  return uniqueItems(urls);
}

async function fetchPlayerHtml(url, request) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml",
      Referer: WORLDKOORA + "/",
    },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return res.text();
}

async function resolvePlayableSourceFromHtml(html, request, depth = 0, seen = new Set()) {
  for (const candidate of extractHlsCandidates(html)) return candidate;
  if (depth >= 3) return null;
  for (const iframeUrl of extractNestedPlayerUrls(html)) {
    if (seen.has(iframeUrl)) continue;
    seen.add(iframeUrl);
    try {
      const nestedHtml = await fetchPlayerHtml(iframeUrl, request);
      if (!nestedHtml) continue;
      const nested = await resolvePlayableSourceFromHtml(nestedHtml, request, depth + 1, seen);
      if (nested) return nested;
    } catch {
      // Try the next nested candidate; upstream hosts rotate and occasionally reset.
    }
  }
  return null;
}

// Headers the origin CDN expects. worldkoora CDNs want the worldkoora Referer;
// dlhd CDNs reject an Origin/Referer, so send UA only. Mirrors the real proxy
// fetch headers so a liveness check matches what playback will actually send.
function streamFetchHeaders(kind, request) {
  const ua = request.headers.get("User-Agent") || "Mozilla/5.0";
  if (kind === "dl") return { "User-Agent": ua, Accept: "*/*" };
  return { "User-Agent": ua, Accept: "*/*", Referer: WORLDKOORA + "/", Origin: WORLDKOORA };
}

function firstMediaLine(manifest) {
  for (const line of manifest.split("\n")) {
    const s = line.trim();
    if (s && !s.startsWith("#")) return s;
  }
  return null;
}

// DEEP liveness: a mirror only counts as playable if we can walk master ->
// variant -> and actually pull the first segment. This is what stops the
// recurring "master says #EXTM3U but the segments 403, so the stream is off"
// class of bug (e.g. dlhd tokens, rotated/expired worldkoora CDN hosts).
async function streamPlays(source, kind, request) {
  const headers = streamFetchHeaders(kind, request);
  try {
    const res = await fetch(source, { headers, redirect: "follow" });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text.trimStart().startsWith("#EXTM3U")) return false;

    let mediaManifestUrl = source;
    let mediaText = text;
    // Master playlist -> follow the first variant to its media playlist.
    if (/#EXT-X-STREAM-INF/i.test(text)) {
      const variant = firstMediaLine(text);
      if (!variant) return false;
      const variantUrl = new URL(variant, source).toString();
      const vres = await fetch(variantUrl, { headers, redirect: "follow" });
      if (!vres.ok) return false;
      mediaText = await vres.text();
      if (!mediaText.trimStart().startsWith("#EXTM3U")) return false;
      mediaManifestUrl = variantUrl;
    }

    // Pull the first segment (or nested media playlist) and require real bytes.
    const seg = firstMediaLine(mediaText);
    if (!seg) return false;
    const segUrl = new URL(seg, mediaManifestUrl).toString();
    const sres = await fetch(segUrl, {
      headers: { ...headers, Range: "bytes=0-2047" },
      redirect: "follow",
    });
    if (!(sres.status === 200 || sres.status === 206)) return false;
    const ctype = (sres.headers.get("Content-Type") || "").toLowerCase();
    if (ctype.includes("text/html")) return false; // 403/error page dressed as 200
    // A media playlist step (segment line was itself an .m3u8): accept as live.
    if (isHlsUrl(segUrl)) return true;
    // Read only the first chunk, then cancel — never download the whole segment.
    if (!sres.body) {
      const buf = await sres.arrayBuffer();
      return buf.byteLength > 0;
    }
    const reader = sres.body.getReader();
    const { value, done } = await reader.read();
    try { await reader.cancel(); } catch { /* noop */ }
    return !done && !!value && value.byteLength > 0;
  } catch {
    return false;
  }
}

async function streamManifestLive(source, kind, request) {
  const headers = streamFetchHeaders(kind, request);
  try {
    const res = await fetch(source, { headers, redirect: "follow" });
    if (!res.ok) return false;
    const text = await res.text();
    return text.trimStart().startsWith("#EXTM3U");
  } catch {
    return false;
  }
}

// Deep probe first; accept manifest-only when segments 403 from the edge but the
// signed proxy can still play (common with rotated worldkoora CDNs).
async function streamResolvable(source, kind, request) {
  if (await streamPlays(source, kind, request)) return true;
  return streamManifestLive(source, kind, request);
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
  out = await asyncReplaceAll(out, /(["'])(https?:\/\/[^"']+\.m3u8(?:[?#][^"']*)?)\1/gi, async (m) => {
    const [whole, q, url] = m;
    if (!shouldProxyStream(url, origin)) return whole;
    const sig = await signTarget(url, secret);
    return `${q}${hlsProxyUrl(url, origin, sig)}${q}`;
  });
  return out;
}

async function resolveNestedIframesInHtml(html, origin, secret, request) {
  return asyncReplaceAll(
    html,
    /<iframe\b[^>]*\bsrc=(["'])(https?:\/\/[^"']+)\1[^>]*>\s*<\/iframe>/gi,
    async (m) => {
      const [whole, , iframeUrl] = m;
      if (!/\/albaplayer\//i.test(iframeUrl)) return whole;
      const resolved = await (async () => {
        try {
          const nestedHtml = await fetchPlayerHtml(iframeUrl, request);
          return nestedHtml ? resolvePlayableSourceFromHtml(nestedHtml, request, 1, new Set([iframeUrl])) : null;
        } catch {
          return null;
        }
      })();
      if (!resolved || !shouldProxyStream(resolved.source, origin)) return whole;
      const sig = await signTarget(resolved.source, secret);
      const proxied = hlsProxyUrl(resolved.source, origin, sig);
      return `<script>AlbaPlayerControl('${btoa(proxied)}','${resolved.player}')</script>`;
    }
  );
}

// Twitch pages cannot join the HLS mirror pool — fix parent host and serve upstream.
function fixTwitchEmbedParents(html, request) {
  try {
    const host = new URL(request.url).hostname;
    return String(html || "").replace(
      /src=(["'])(https:\/\/player\.twitch\.tv\/\?[^"']+)\1/gi,
      (_m, q, src) => {
        const u = new URL(src);
        u.searchParams.set("parent", host);
        return `src=${q}${u.toString()}${q}`;
      }
    );
  } catch {
    return html;
  }
}

async function cleanWorldkooraHtml(html, slot, origin, secret, request) {
  let out = stripBlockedScripts(html);
  out = fixTwitchEmbedParents(out, request);
  out = await resolveNestedIframesInHtml(out, origin, secret, request);
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

// Our own clean HLS player. Serving this (instead of the rotating upstream
// Clappr/JW/preroll markup) decouples playback from whatever wrapper worldkoora
// ships this game — the recurring source of "stream is off" breakage.
//
// It is fed a RANKED LIST of already-verified-live signed mirror URLs, not one
// URL. If the playing mirror dies mid-match (worldkoora's CDN hosts rotate and
// die constantly), the player advances to the next live mirror on its own, so a
// single dead host no longer takes the stream off.
function cleanHlsPlayerHtml(sources, title) {
  const list = Array.isArray(sources) ? sources.filter(Boolean) : [sources].filter(Boolean);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title || "KoraZero"}</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#v{width:100vw;height:100vh;background:#000;object-fit:contain}</style>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
</head><body>
<video id="v" controls autoplay muted playsinline data-kz-src=${JSON.stringify(list[0] || "")}></video>
<script>
(function(){
  var v=document.getElementById('v'), sources=${JSON.stringify(list)}, i=0, hls=null, tries=0;
  function destroy(){ if(hls){ try{hls.destroy();}catch(e){} hls=null; } }
  function next(){ i=(i+1)%sources.length; tries++; if(tries<=sources.length*3){ setTimeout(load, 800); } }
  function load(){
    var src=sources[i]; if(!src) return;
    destroy();
    if(v.canPlayType('application/vnd.apple.mpegurl')){
      v.src=src; v.addEventListener('error', next, {once:true});
    } else if(window.Hls&&window.Hls.isSupported()){
      hls=new Hls({maxBufferLength:30,liveSyncDurationCount:3,manifestLoadingMaxRetry:4,levelLoadingMaxRetry:4,fragLoadingMaxRetry:4});
      hls.loadSource(src); hls.attachMedia(v);
      hls.on(Hls.Events.ERROR,function(_e,d){
        if(!d||!d.fatal) return;
        if(d.type==='mediaError'){ try{hls.recoverMediaError();return;}catch(e){} }
        // network/other fatal: this mirror is down — advance to the next live one.
        next();
      });
    } else { v.src=src; }
    var p=v.play&&v.play(); if(p&&p.catch)p.catch(function(){});
  }
  load();
})();
</script>
</body></html>`;
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

// Fetch one worldkoora VIP server page (a single "البث N" for a slot).
async function fetchVipServerHtml(request, slot, serv) {
  const upstream = new URL(`${WORLDKOORA}/albaplayer/${slot}/`);
  upstream.searchParams.set("serv", String(serv));
  try {
    const res = await fetch(upstream.toString(), {
      method: "GET",
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml",
        Referer: `${WORLDKOORA}/`,
      },
      redirect: "follow",
    });
    if (!res.ok) return { status: res.status, html: null };
    return { status: 200, html: await res.text() };
  } catch {
    return { status: 502, html: null };
  }
}

// Server order within a slot: the requested "البث N" first, then the rest, so a
// blank/dead server this game self-heals to another server of the SAME channel.
function vipServerOrder(requestedServ) {
  const order = [];
  const req = Number(requestedServ);
  if (Number.isFinite(req) && req >= 1 && req <= VIP_SERVER_COUNT) order.push(req);
  for (let s = 1; s <= VIP_SERVER_COUNT; s++) if (!order.includes(s)) order.push(s);
  return order;
}

// Actively build a ranked pool of VERIFIED-live HLS mirrors for a slot at request
// time. Every "بث N" server of the SAME slot is resolved and liveness-checked, so
// dead CDN hosts (worldkoora rotates and kills these constantly) are dropped and
// the live ones become failover mirrors. Only servers of the SAME slot are used —
// never a different channel/slot. Returns { candidates, firstHtml }.
async function resolveVipSlotStream(request, slot) {
  const requestedServ = new URL(request.url).searchParams.get("serv") || 1;
  let firstHtml = null;
  const candidates = [];
  const seenSources = new Set();
  for (const serv of vipServerOrder(requestedServ)) {
    const page = await fetchVipServerHtml(request, slot, serv);
    if (!page.html) continue;
    if (firstHtml == null) firstHtml = page.html;
    const resolved = await resolvePlayableSourceFromHtml(page.html, request, 0, new Set());
    if (!resolved || seenSources.has(resolved.source)) continue;
    if (await streamResolvable(resolved.source, "wk", request)) {
      seenSources.add(resolved.source);
      candidates.push({ ...resolved, serv });
    }
  }
  return { candidates, firstHtml };
}

// Resolve the stable dlhd mirror for a fixed beIN Sports channel (same channel,
// 24/7). Used only as a lower-priority backup in the mirror pool. Signed for the
// /dl/hls proxy because the dlhd CDN rejects the worldkoora Referer/Origin.
async function resolveDlChannelMirror(channelId, origin, secret, request) {
  const id = DLHD_CHANNEL_IDS[channelId];
  if (!id) return null;
  const m3u8 = await resolveDlStream(id);
  if (!m3u8 || !isHlsUrl(m3u8)) return null;
  if (!(await streamPlays(m3u8, "dl", request))) return null;
  const sig = await signTarget(m3u8, secret);
  return hlsProxyUrl(m3u8, origin, sig, "/dl/hls");
}

async function proxyVip(request, slot, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const channelId = incoming.searchParams.get("ch") || "";
  const secret = env && env.STREAM_SIGNING_SECRET;
  const isHead = request.method === "HEAD";
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-KZ-Proxy": "worldkoora-vip",
  };

  if (isHead) {
    const requestedServ = incoming.searchParams.get("serv") || 1;
    const page = await fetchVipServerHtml(request, slot, requestedServ);
    const status = page.html ? 200 : (DLHD_CHANNEL_IDS[channelId] ? 200 : page.status);
    return new Response(null, { status, headers: htmlHeaders });
  }

  try {
    const requestedServ = Number(incoming.searchParams.get("serv") || 1);
    const requestedPage = await fetchVipServerHtml(request, slot, requestedServ);
    if (requestedPage.html && /player\.twitch\.tv/i.test(requestedPage.html)) {
      return new Response(await cleanWorldkooraHtml(requestedPage.html, slot, origin, secret, request), {
        status: 200,
        headers: { ...htmlHeaders, "X-KZ-Serv": String(requestedServ) },
      });
    }

    const { candidates, firstHtml } = await resolveVipSlotStream(request, slot);
    const ranked = (candidates || []).slice().sort((a, b) => {
      if (a.serv === requestedServ && b.serv !== requestedServ) return -1;
      if (b.serv === requestedServ && a.serv !== requestedServ) return 1;
      return 0;
    });
    const proxied = [];
    for (const c of ranked) {
      const sig = await signTarget(c.source, secret);
      proxied.push(hlsProxyUrl(c.source, origin, sig));
    }
    // Append the stable dlhd mirror for the SAME beIN channel as a last-priority
    // backup, so a fully-dead worldkoora slot still keeps the channel playing.
    const dlMirror = await resolveDlChannelMirror(channelId, origin, secret, request);
    if (dlMirror && !proxied.includes(dlMirror)) proxied.push(dlMirror);

    if (proxied.length) {
      return new Response(cleanHlsPlayerHtml(proxied, `${slot} بث`), {
        status: 200,
        headers: {
          ...htmlHeaders,
          "X-KZ-Serv": String((ranked[0] && ranked[0].serv) || ""),
          "X-KZ-Mirrors": String(proxied.length),
        },
      });
    }
    // Last resort: nothing resolved live (e.g. slot is 403/blank this game).
    // Serve the preroll-stripped upstream page so any client-side player still
    // has a chance, rather than a hard error.
    if (firstHtml) {
      return new Response(await cleanWorldkooraHtml(firstHtml, slot, origin, secret, request), {
        status: 200,
        headers: htmlHeaders,
      });
    }
    return new Response("Upstream unavailable", { status: 502 });
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
  return cleanHlsPlayerHtml(src, `beIN ${id}`);
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

/* ----------------------------------------------- yallak0ra per-match AlbaPlayer
 * Match pages on yallak0ra.com / koraalive.net expose the same AlbaPlayer stack
 * as worldkoora (AlbaPlayerControl base64 m3u8 + nested /albaplayer/ iframes on
 * yalla-sh.com). Resolve + liveness-check at request time; pool serv=1..N. */
const YALLA_EMBED_RE = /^\/yk\/embed\/?$/i;
const YALLA_HLS_RE = /^\/yk\/hls$/i;
const YALLA_SERVER_COUNT = 7;
const YALLA_ALLOWED_HOST = /(^|\.)((yallak0ra\.com|koraalive\.net)|yalla-sh\.com)$/i;
const YALLA_INDEX_URLS = ["https://www.yallak0ra.com/", "https://www.yallak0ra.com/matches-today/"];
const YALLA_ACTIVE_STATUS = /^(live|started|gools)/i;

function parseYallaMatchBlocks(html) {
  const blocks = [];
  for (const block of String(html || "").split(/(?=<div class="AY_Match )/).slice(1)) {
    const status = ((block.match(/AY_Match (\S+)/) || [])[1] || "").replace(/">$/, "").trim();
    const names = [...block.matchAll(/class="TM_Name">\s*([^<]+)/g)].map((m) => m[1].trim());
    const link =
      (block.match(/<a href="([^"]+)"[^>]*title="تفاصيل/) || [])[1] ||
      (block.match(/<a href="([^"]+)"[^>]*><div class='MT_Mask'/) || [])[1] ||
      "";
    if (names.length >= 2 && link) blocks.push({ status, names, link });
  }
  return blocks;
}

function teamSlug(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function yallaLinkMatchesTeams(link, home, away) {
  if (!home && !away) return false;
  const slug = String(link || "").toLowerCase();
  const hs = teamSlug(home);
  const as = teamSlug(away);
  return (hs && slug.includes(hs)) || (as && slug.includes(as));
}

async function discoverYallaPage(request, hints = {}) {
  const { home, away, page } = hints;
  if (page && isYallaAllowedUrl(page)) return page;

  for (const url of YALLA_INDEX_URLS) {
    const html = await fetchYallaHtml(url, request);
    if (!html) continue;
    const blocks = parseYallaMatchBlocks(html);

    for (const card of blocks) {
      if (YALLA_ACTIVE_STATUS.test(card.status) && isYallaAllowedUrl(card.link)) return card.link;
    }

    if (home || away) {
      for (const card of blocks) {
        if (yallaLinkMatchesTeams(card.link, home, away) && isYallaAllowedUrl(card.link)) return card.link;
      }
    }

    // Extra time: yallak0ra may flip to finished while the stream is still up on koraalive.
    for (const card of blocks) {
      if (/^finished/i.test(card.status) && /koraalive\.net/i.test(card.link)) return card.link;
    }
  }
  return null;
}

function isYallaAllowedUrl(target) {
  try {
    return YALLA_ALLOWED_HOST.test(new URL(target).hostname);
  } catch {
    return false;
  }
}

function yallaRefererFor(url) {
  try {
    const u = new URL(url);
    if (/\/albaplayer/i.test(u.pathname)) return u.toString();
    return `${u.origin}/`;
  } catch {
    return "https://www.yallak0ra.com/";
  }
}

async function fetchYallaHtml(url, request) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml",
        Referer: yallaRefererFor(url),
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

function extractYallaPlayerUrls(html) {
  const urls = [];
  const text = String(html || "");
  for (const m of text.matchAll(/<iframe\b[^>]*\bsrc=(["'])(https?:\/\/[^"']+)\1[^>]*>/gi)) {
    if (/\/albaplayer\//i.test(m[2]) && isYallaAllowedUrl(m[2])) urls.push(m[2]);
  }
  for (const m of text.matchAll(/href=(["'])(https?:\/\/[^"']+\/albaplayer\/[^"']+)\1/gi)) {
    if (isYallaAllowedUrl(m[2])) urls.push(m[2]);
  }
  return uniqueItems(urls);
}

function albaplayerBaseUrl(url) {
  try {
    const u = new URL(url);
    u.search = "";
    return u.toString();
  } catch {
    return url;
  }
}

function yallaServerOrder(requestedServ) {
  const order = [];
  const req = Number(requestedServ);
  if (Number.isFinite(req) && req >= 1 && req <= YALLA_SERVER_COUNT) order.push(req);
  for (let s = 1; s <= YALLA_SERVER_COUNT; s++) if (!order.includes(s)) order.push(s);
  return order;
}

async function resolveYallaFromHtml(html, request, refererUrl, depth = 0, seen = new Set()) {
  for (const candidate of extractHlsCandidates(html)) return candidate;
  if (depth >= 3) return null;
  for (const iframeUrl of extractYallaPlayerUrls(html)) {
    if (seen.has(iframeUrl)) continue;
    seen.add(iframeUrl);
    const nestedHtml = await fetchYallaHtml(iframeUrl, request);
    if (!nestedHtml) continue;
    const nested = await resolveYallaFromHtml(nestedHtml, request, iframeUrl, depth + 1, seen);
    if (nested) return nested;
  }
  return null;
}

async function streamYallaLive(source, refererUrl, request) {
  const headers = {
    "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
    Accept: "*/*",
    Referer: yallaRefererFor(refererUrl || source),
  };
  try {
    const res = await fetch(source, { headers, redirect: "follow" });
    if (!res.ok) return false;
    const text = await res.text();
    return text.trimStart().startsWith("#EXTM3U");
  } catch {
    return false;
  }
}

async function streamYallaResolvable(source, refererUrl, request) {
  if (await streamYallaLive(source, refererUrl, request)) return true;
  return streamManifestLive(source, "wk", request);
}

async function resolveYallaMatchStreams(request, pageUrl, requestedServ) {
  const html = await fetchYallaHtml(pageUrl, request);
  if (!html) return { candidates: [], firstHtml: null };
  const firstHtml = html;
  const candidates = [];
  const seenSources = new Set();

  const direct = await resolveYallaFromHtml(html, request, pageUrl, 0, new Set());
  if (direct && !seenSources.has(direct.source) && (await streamYallaResolvable(direct.source, pageUrl, request))) {
    seenSources.add(direct.source);
    candidates.push({ ...direct, serv: requestedServ || 1, refUrl: pageUrl });
  }

  const playerBases = uniqueItems(extractYallaPlayerUrls(html).map(albaplayerBaseUrl));
  for (const base of playerBases) {
    for (const serv of yallaServerOrder(requestedServ)) {
      const playerUrl = `${base}?serv=${serv}`;
      const playerHtml = await fetchYallaHtml(playerUrl, request);
      if (!playerHtml) continue;
      const resolved = await resolveYallaFromHtml(playerHtml, request, playerUrl, 0, new Set());
      if (!resolved || seenSources.has(resolved.source)) continue;
      if (!(await streamYallaResolvable(resolved.source, playerUrl, request))) continue;
      seenSources.add(resolved.source);
      candidates.push({ ...resolved, serv, refUrl: playerUrl });
    }
  }

  return { candidates, firstHtml };
}

async function proxyYallaEmbed(request, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const secret = env && env.STREAM_SIGNING_SECRET;
  const autoLive = incoming.searchParams.get("auto") === "live";
  let pageUrl = incoming.searchParams.get("page") || "";
  const teamHome = incoming.searchParams.get("home") || "";
  const teamAway = incoming.searchParams.get("away") || "";
  const requestedServ = Number(incoming.searchParams.get("serv") || 1);
  const isHead = request.method === "HEAD";
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-KZ-Proxy": "yalla-embed",
  };

  if (autoLive) {
    const discovered = await discoverYallaPage(request, {
      home: teamHome,
      away: teamAway,
      page: pageUrl,
    });
    if (discovered) pageUrl = discovered;
  }
  if (!pageUrl || !isYallaAllowedUrl(pageUrl)) {
    return new Response("No live yalla stream found", { status: 404, headers: htmlHeaders });
  }
  if (isHead) {
    return new Response(null, {
      status: 200,
      headers: { ...htmlHeaders, "X-KZ-Yalla-Page": pageUrl },
    });
  }

  try {
    const peek = await fetchYallaHtml(pageUrl, request);
    if (peek && /player\.twitch\.tv/i.test(peek)) {
      return new Response(fixTwitchEmbedParents(await cleanWorldkooraHtml(peek, "yk", origin, secret, request), request), {
        status: 200,
        headers: htmlHeaders,
      });
    }

    const { candidates, firstHtml } = await resolveYallaMatchStreams(request, pageUrl, requestedServ);
    const ranked = (candidates || []).slice().sort((a, b) => {
      if (a.serv === requestedServ && b.serv !== requestedServ) return -1;
      if (b.serv === requestedServ && a.serv !== requestedServ) return 1;
      return 0;
    });
    const proxied = [];
    for (const c of ranked) {
      const sig = await signTarget(c.source, secret);
      proxied.push(hlsProxyUrl(c.source, origin, sig, "/yk/hls", c.refUrl || pageUrl));
    }

    if (proxied.length) {
      return new Response(cleanHlsPlayerHtml(proxied, "يلا كورة"), {
        status: 200,
        headers: {
          ...htmlHeaders,
          "X-KZ-Yalla-Page": pageUrl,
          "X-KZ-Serv": String((ranked[0] && ranked[0].serv) || ""),
          "X-KZ-Mirrors": String(proxied.length),
        },
      });
    }

    if (firstHtml) {
      return new Response(await cleanWorldkooraHtml(firstHtml, "yk", origin, secret, request), {
        status: 200,
        headers: { ...htmlHeaders, "X-KZ-Yalla-Page": pageUrl },
      });
    }
    return new Response("Upstream unavailable", { status: 502 });
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }
}

async function proxyYallaHls(request, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const target = incoming.searchParams.get("u");
  const sig = incoming.searchParams.get("sig");
  const ref = incoming.searchParams.get("ref") || "";
  const secret = env && env.STREAM_SIGNING_SECRET;
  const trusted = target && ((await verifyTarget(target, sig, secret)) || isAllowedStreamUrl(target));
  if (!trusted) {
    return new Response("Forbidden stream host", { status: 403 });
  }
  const referer = yallaRefererFor(ref || target);
  const isHead = request.method === "HEAD";
  try {
    const res = await fetch(target, {
      method: request.method,
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        Accept: "*/*",
        Referer: referer,
      },
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
        "X-KZ-Proxy": "yalla-manifest",
      };
      if (isHead) return new Response(null, { status: 200, headers: manifestHeaders });
      const text = await res.text();
      const rewritten = await rewriteM3u8(text, target, origin, secret, "/yk/hls", ref);
      return new Response(rewritten, { status: 200, headers: manifestHeaders });
    }
    const headers = {
      "Content-Type": segmentContentType(target) || res.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*",
      "X-KZ-Proxy": "yalla-segment",
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
// Regions (percent of the VIDEO FRAME, not the player container) where the
// upstream burns its own branding into the picture: top-left corner mark,
// top-right "SIR TV / LIVE" badge, and a bottom promo bar + QR code. Measured
// from a live AR1 capture. AR2 shares the same underlying feed (kooora/kc/*,
// same domain pattern) so it reuses this config; FR/EN come from a visibly
// different upstream path (kooora/*xfr|xen, not kc/*) and haven't been
// confirmed to carry the same overlay, so they're left unmasked until checked.
const AR_MASK_REGIONS = [
  { top: 2, left: 0, width: 5, height: 7 },      // top-left corner mark
  { top: 2, left: 79, width: 21, height: 14 },   // top-right "SIR TV" / LIVE badge
  { top: 78, left: 88, width: 12, height: 15 },  // bottom-right QR code + caption
  { top: 91, left: 0, width: 100, height: 9 },   // bottom-width promo bar
];
const SIR_MASK_REGIONS = { ar1: AR_MASK_REGIONS, ar2: AR_MASK_REGIONS };

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
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SIR ${SIR_LABELS[slug] || slug} — تجريبي</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:system-ui,sans-serif}
#stage{position:relative;width:100vw;height:100vh;background:#000}
#v{width:100%;height:100%;background:#000;object-fit:contain;display:block}
#stage:fullscreen #v{object-fit:contain}
#stage:-webkit-full-screen #v{object-fit:contain}
.ctl{position:absolute;display:flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:10px;background:rgba(10,12,24,.62);color:#fff;cursor:pointer;backdrop-filter:blur(6px);font-family:inherit;font-weight:700}
#unmute-overlay{top:0;left:0;right:0;bottom:0;width:100%;height:100%;border-radius:0;background:rgba(8,10,20,.55);font-size:16px;flex-direction:column;gap:10px;z-index:4}
#unmute-overlay .ico{font-size:40px;line-height:1}
#bottom-bar{left:10px;right:10px;bottom:10px;height:0;z-index:5;justify-content:space-between;background:none;backdrop-filter:none;pointer-events:none}
#bottom-bar > *{pointer-events:auto}
#mute-btn,#fs-btn{position:static;width:42px;height:42px;font-size:18px}
.mask{position:absolute;pointer-events:none;background:rgba(0,0,0,.1);backdrop-filter:blur(22px) saturate(1.15);-webkit-backdrop-filter:blur(22px) saturate(1.15);z-index:3}
.hidden{display:none!important}
</style>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
</head><body>
<div id="stage">
  <video id="v" autoplay muted playsinline></video>
  <div id="mask-layer">${(SIR_MASK_REGIONS[slug] || []).map(() => '<div class="mask"></div>').join('')}</div>
  <button type="button" id="unmute-overlay" class="ctl"><span class="ico">🔇</span><span>اضغط لتشغيل الصوت</span></button>
  <div id="bottom-bar" class="ctl" style="position:absolute">
    <button type="button" id="mute-btn" class="ctl">🔇</button>
    <button type="button" id="fs-btn" class="ctl">⛶</button>
  </div>
</div>
<script>
(function(){
  var v=document.getElementById('v'), src=${JSON.stringify(src)};
  var stage=document.getElementById('stage');
  var overlay=document.getElementById('unmute-overlay');
  var muteBtn=document.getElementById('mute-btn');
  var fsBtn=document.getElementById('fs-btn');
  var userMuted=false; // true only when the user deliberately muted via mute-btn (not a policy-forced mute)

  // Blur out the upstream's burned-in branding (see SIR_MASK_REGIONS). Regions are
  // percentages of the VIDEO FRAME itself, so this has to track the video's actual
  // rendered rectangle inside #stage (object-fit:contain letterboxes it) rather
  // than just filling the container.
  var MASKS=${JSON.stringify(SIR_MASK_REGIONS[slug] || [])};
  var maskEls=Array.prototype.slice.call(document.querySelectorAll('.mask'));
  var lastCw,lastCh,lastVw,lastVh;
  function positionMasks(){
    if(!MASKS.length || !v.videoWidth || !v.videoHeight) return;
    var cw=stage.clientWidth, ch=stage.clientHeight;
    if(!cw || !ch) return;
    if(cw===lastCw && ch===lastCh && v.videoWidth===lastVw && v.videoHeight===lastVh) return;
    lastCw=cw; lastCh=ch; lastVw=v.videoWidth; lastVh=v.videoHeight;
    var videoAR=v.videoWidth/v.videoHeight, containerAR=cw/ch;
    var rectW,rectH,rectX,rectY;
    if(videoAR>containerAR){ rectW=cw; rectH=cw/videoAR; rectX=0; rectY=(ch-rectH)/2; }
    else { rectH=ch; rectW=ch*videoAR; rectY=0; rectX=(cw-rectW)/2; }
    MASKS.forEach(function(r,i){
      var el=maskEls[i];
      if(!el) return;
      el.style.left=(rectX+r.left/100*rectW)+'px';
      el.style.top=(rectY+r.top/100*rectH)+'px';
      el.style.width=(r.width/100*rectW)+'px';
      el.style.height=(r.height/100*rectH)+'px';
    });
  }
  v.addEventListener('loadedmetadata', positionMasks);
  window.addEventListener('resize', positionMasks);
  document.addEventListener('fullscreenchange', positionMasks);
  document.addEventListener('webkitfullscreenchange', positionMasks);
  v.addEventListener('webkitbeginfullscreen', positionMasks);
  v.addEventListener('webkitendfullscreen', positionMasks);
  positionMasks();
  if(MASKS.length) setInterval(positionMasks, 1000); // cheap safety net for resize paths that don't fire an event (e.g. some iOS rotations)

  function syncMuteUi(){
    muteBtn.textContent = v.muted ? '🔇' : '🔊';
    // Show the overlay whenever playback isn't actually going (so there's always a
    // tap target to start it) or sound is off for a reason other than the user's
    // own choice — but not after the user deliberately mutes mid-playback.
    var showOverlay = v.paused || (v.muted && !userMuted);
    overlay.classList.toggle('hidden', !showOverlay);
  }
  function unmute(){
    v.muted=false;
    userMuted=false;
    var p=v.play&&v.play();
    if(p&&p.catch)p.catch(function(){ v.muted=true; });
    syncMuteUi();
  }
  overlay.addEventListener('click', unmute);
  muteBtn.addEventListener('click', function(){
    if(v.muted){ unmute(); }
    else { v.muted=true; userMuted=true; syncMuteUi(); }
  });
  v.addEventListener('volumechange', syncMuteUi);
  v.addEventListener('playing', syncMuteUi);
  v.addEventListener('pause', syncMuteUi);

  function isFullscreen(){ return !!(document.fullscreenElement||document.webkitFullscreenElement||v.webkitDisplayingFullscreen); }
  function syncFsUi(){ fsBtn.textContent = isFullscreen() ? '⤢' : '⛶'; }
  fsBtn.addEventListener('click', function(){
    if(isFullscreen()){
      (document.exitFullscreen||document.webkitExitFullscreen||function(){}).call(document);
    } else if(stage.requestFullscreen){
      stage.requestFullscreen().catch(function(){ if(v.webkitEnterFullscreen)v.webkitEnterFullscreen(); });
    } else if(stage.webkitRequestFullscreen){
      stage.webkitRequestFullscreen();
    } else if(v.webkitEnterFullscreen){
      v.webkitEnterFullscreen(); // iOS Safari: only the <video> itself supports native fullscreen
    }
  });
  document.addEventListener('fullscreenchange', syncFsUi);
  document.addEventListener('webkitfullscreenchange', syncFsUi);
  v.addEventListener('webkitbeginfullscreen', syncFsUi);
  v.addEventListener('webkitendfullscreen', syncFsUi);

  function start(){
    // Only attempt play() once there's an actual media source ready to play —
    // calling it earlier (e.g. right after hls.js attachMedia, before it has
    // loaded anything) rejects for unrelated reasons and would wrongly be read
    // as "autoplay blocked", forcing mute even on browsers that'd allow sound.
    var autoplayDecided=false;
    function resumePlay(){
      var p=v.play&&v.play();
      if(p&&p.catch)p.catch(function(){});
    }
    function attemptPlay(){
      // hls.js can re-fire MANIFEST_PARSED after recovering from a fatal network
      // error (loadSource() re-runs); only decide the mute/autoplay outcome once,
      // otherwise that recovery path would force-unmute over a deliberate mute.
      if(autoplayDecided){ resumePlay(); return; }
      autoplayDecided=true;
      v.muted=false;
      var p=v.play&&v.play();
      if(p&&p.catch){
        p.catch(function(){ v.muted=true; resumePlay(); syncMuteUi(); });
      }
      syncMuteUi();
    }
    if(v.canPlayType('application/vnd.apple.mpegurl')){
      v.src=src;
      attemptPlay();
    } else if(window.Hls&&window.Hls.isSupported()){
      var h=new Hls({maxBufferLength:30,liveSyncDurationCount:3,manifestLoadingMaxRetry:6,fragLoadingMaxRetry:6});
      h.loadSource(src); h.attachMedia(v);
      h.on(Hls.Events.MANIFEST_PARSED, attemptPlay);
      h.on(Hls.Events.ERROR,function(_e,d){ if(d&&d.fatal){ if(d.type==='networkError'){ setTimeout(function(){try{h.startLoad();}catch(e){h.loadSource(src);}},2000);} else if(d.type==='mediaError'){ try{h.recoverMediaError();}catch(e){} } } });
    } else {
      v.src=src;
      attemptPlay();
    }
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
    if (YALLA_EMBED_RE.test(url.pathname) && (method === "GET" || method === "HEAD")) {
      return proxyYallaEmbed(request, env);
    }
    if (YALLA_HLS_RE.test(url.pathname) && (method === "GET" || method === "HEAD" || method === "OPTIONS")) {
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
      return proxyYallaHls(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
