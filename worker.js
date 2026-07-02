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

async function hlsManifestIsLive(source, request) {
  try {
    const res = await fetch(source, {
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        Accept: "application/vnd.apple.mpegurl,*/*",
        Referer: WORLDKOORA + "/",
      },
      redirect: "follow",
    });
    if (!res.ok) return false;
    const text = await res.text();
    return text.trimStart().startsWith("#EXTM3U");
  } catch {
    return false;
  }
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

async function cleanWorldkooraHtml(html, slot, origin, secret, request) {
  let out = stripBlockedScripts(html);
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
    if (await hlsManifestIsLive(resolved.source, request)) {
      seenSources.add(resolved.source);
      candidates.push({ ...resolved, serv });
    }
  }
  return { candidates, firstHtml };
}

async function proxyVip(request, slot, env) {
  const origin = new URL(request.url).origin;
  const secret = env && env.STREAM_SIGNING_SECRET;
  const isHead = request.method === "HEAD";
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-KZ-Proxy": "worldkoora-vip",
  };

  if (isHead) {
    const requestedServ = new URL(request.url).searchParams.get("serv") || 1;
    const page = await fetchVipServerHtml(request, slot, requestedServ);
    return new Response(null, { status: page.html ? 200 : page.status, headers: htmlHeaders });
  }

  try {
    const { candidates, firstHtml } = await resolveVipSlotStream(request, slot);
    // Preferred path: one or more verified-live mirrors, wrapped in our own clean
    // player with automatic mirror failover.
    if (candidates && candidates.length) {
      const proxied = [];
      for (const c of candidates) {
        const sig = await signTarget(c.source, secret);
        proxied.push(hlsProxyUrl(c.source, origin, sig));
      }
      return new Response(cleanHlsPlayerHtml(proxied, `${slot} بث`), {
        status: 200,
        headers: { ...htmlHeaders, "X-KZ-Serv": String(candidates[0].serv), "X-KZ-Mirrors": String(proxied.length) },
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
    return env.ASSETS.fetch(request);
  },
};
