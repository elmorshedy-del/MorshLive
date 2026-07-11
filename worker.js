import { FiltersEngine, Request as AdblockRequest } from "@ghostery/adblocker";
import {
  memeIsRecent,
  recentMemeDayKeys,
  todayMemeDayKey,
} from "./lib/meme-threshold.js";
import {
  classifyHomeMeme,
  computeAccountLikesThreshold,
  computeRecentAccountThreshold,
  filterMemesWithMedia,
  memeHasMedia,
  selectHomeScrollMemes,
  WC_HOME_SINCE_UTC,
} from "./lib/meme-select.js";
import { resolveStreamUrl, rewriteReplayM3u8 as rewriteReplayM3u8Lines } from "./lib/replay-hls.js";
import { dispatchBackendRoutes } from "./backend/router.js";
import { backendRoutes } from "./backend/routes/index.js";

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
// worldkoora's public host. It rebrands/rotates periodically (the whole
// front-end domain, not just the CDN): vip.worldkoora.com -> mysportv.live
// (confirmed via a 301 on 2026-07-06). Every Referer/Origin the worker sends
// to the player page AND to the CDN derives from this constant, so the new
// host's own-referer gating is satisfied by updating just this line. If live
// MAX matches stop resolving (all /wk/albaplayer/vip* return 502), check
// `curl -sI https://vip.worldkoora.com/albaplayer/vip1/` for a fresh 301
// target and update here.
const WORLDKOORA = "https://mysportv.live";
const WESHAN = "https://zenvixw.site/wordpress/albaplayer/weshan/";
const VIP_RE = /^\/wk\/albaplayer\/(vip[12])\/?$/i;
const WESHAN_RE = /^\/wk\/albaplayer\/weshan\/?$/i;
const SIRTV_CH1_PLAYER = "https://we.shootsync.site/albaplayer/sniaer/";
const SIRTV_CH1_REFERER = "https://s.sirtv.space/2026/02/ch1.html?m=1";
const SIRTV_RE = /^\/wk\/albaplayer\/sirtv\/?$/i;
const KOORA_CITY = "https://kooora-city.com/";
const KOORA_YALASHOT_DEFAULT = "https://tt.yalashot.online/2026/06/ch1.html?m=1";
const KOORACITY_RE = /^\/wk\/albaplayer\/kooracity\/?$/i;
const KOORA_TEAM_AR = {
  argentina: "الأرجنتين",
  australia: "أستراليا",
  austria: "النمسا",
  belgium: "بلجيكا",
  brazil: "البرازيل",
  cameroon: "الكاميرون",
  canada: "كندا",
  capeverde: "الرأس الأخضر",
  chile: "تشيلي",
  colombia: "كولومبيا",
  costarica: "كوستاريكا",
  croatia: "كرواتيا",
  czechia: "التشيك",
  czechrepublic: "التشيك",
  denmark: "الدنمارك",
  ecuador: "الإكوادور",
  egypt: "مصر",
  england: "إنجلترا",
  france: "فرنسا",
  germany: "ألمانيا",
  ghana: "غانا",
  greece: "اليونان",
  iran: "إيران",
  iraq: "العراق",
  italy: "إيطاليا",
  ivorycoast: "ساحل العاج",
  japan: "اليابان",
  jordan: "الأردن",
  mexico: "المكسيك",
  morocco: "المغرب",
  netherlands: "هولندا",
  newzealand: "نيوزيلندا",
  nigeria: "نيجيريا",
  norway: "النرويج",
  panama: "بنما",
  paraguay: "باراغواي",
  peru: "بيرو",
  poland: "بولندا",
  portugal: "البرتغال",
  qatar: "قطر",
  saudiarabia: "السعودية",
  senegal: "السنغال",
  serbia: "صربيا",
  southafrica: "جنوب أفريقيا",
  southkorea: "كوريا الجنوبية",
  spain: "إسبانيا",
  switzerland: "سويسرا",
  tunisia: "تونس",
  turkey: "تركيا",
  unitedarabemirates: "الإمارات",
  unitedstates: "الولايات المتحدة",
  uruguay: "أوروغواي",
  uzbekistan: "أوزبكستان",
  wales: "ويلز",
};
const NTV_EMBED =
  "https://ntv.cx/embed?t=OFd0cFZIcCtUQ3NleURxSUs1SW9VQW81eDZjTHdaUjNGL0RxZWZUU24zVTNIQlVsbEpqTkgzbkk3TmhiRGJwMw~~";
const NTV_RE = /^\/wk\/albaplayer\/ntv\/?$/i;
const ALT_STREAM_AD_HOSTS =
  /cosetengarb|corruptioneasiest|histats|acscdn|aclib|doubleclick|googlesyndication|popads|propeller|exoclick|adsterra|mgid|taboola|outbrain|cloudflareinsights|console-ban|pubads|googletagmanager|google-analytics|imasdk|advertising|\/ads\//i;
const POLL_RE = /^\/api\/poll\/([a-z0-9.-]+)\/?$/i;
const POLL_STORE = "https://kz-poll.internal/";
const POLL_TEAMS = {
  "brazil-norway-20260705": ["brazil", "norway"],
};

let _pollConfigCache = null;
let _pollConfigAt = 0;

let _streamRoutesCache = null;
let _streamRoutesAt = 0;

const DEFAULT_STREAM_ROUTES = {
  version: 1,
  slots: {
    ntv: { embedUrl: NTV_EMBED, wrapperUrl: null, chain: [] },
    sirTv: { player: SIRTV_CH1_PLAYER, referer: SIRTV_CH1_REFERER },
    kooraCity: { defaultCard: KOORA_YALASHOT_DEFAULT, wrapperUrl: null },
    amine: { base: "https://yallashooot.tv/albaplayer/amine/", defaultServ: 0 },
  },
  byMatch: {},
};

async function loadStreamRoutes(env, origin) {
  if (_streamRoutesCache && Date.now() - _streamRoutesAt < 60 * 1000) return _streamRoutesCache;
  try {
    const res = await env.ASSETS.fetch(`${origin}/assets/data/stream-routes.json`);
    if (res.ok) {
      const raw = await res.json();
      _streamRoutesCache = {
        ...DEFAULT_STREAM_ROUTES,
        ...raw,
        slots: { ...DEFAULT_STREAM_ROUTES.slots, ...(raw.slots || {}) },
        byMatch: { ...(raw.byMatch || {}) },
      };
    } else {
      _streamRoutesCache = DEFAULT_STREAM_ROUTES;
    }
  } catch {
    _streamRoutesCache = DEFAULT_STREAM_ROUTES;
  }
  _streamRoutesAt = Date.now();
  return _streamRoutesCache;
}

function matchRouteKey(home, away) {
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  return [norm(home), norm(away)].filter(Boolean).sort().join("~");
}

function isDeadShellHtml(html) {
  const t = String(html || "").trim().slice(0, 500);
  return /forbidden|access denied|upstream unavailable|invalid or expired stream token/i.test(t);
}

function pickNtvWrapperUrl(resolvedUrl, routes) {
  const healed = routes?.slots?.ntv?.wrapperUrl;
  if (healed && !/hls2\.php\?stream=/i.test(healed)) return healed;
  if (resolvedUrl && !/hls2\.php\?stream=/i.test(resolvedUrl)) return resolvedUrl;
  return healed || resolvedUrl || null;
}

async function loadPollConfig(env, origin) {
  if (_pollConfigCache && Date.now() - _pollConfigAt < 60 * 1000) return _pollConfigCache;
  try {
    const res = await env.ASSETS.fetch(`${origin}/assets/data/match-poll.json`);
    _pollConfigCache = res.ok ? await res.json() : { polls: [] };
  } catch {
    _pollConfigCache = { polls: [] };
  }
  _pollConfigAt = Date.now();
  return _pollConfigCache;
}

async function pollTeamsFor(pollId, env, origin) {
  if (POLL_TEAMS[pollId]) return POLL_TEAMS[pollId];
  const cfg = await loadPollConfig(env, origin);
  const polls = Array.isArray(cfg.polls) ? cfg.polls : (cfg.pollId ? [cfg] : []);
  const hit = polls.find((p) => p.pollId === pollId);
  if (hit && hit.homeKey && hit.awayKey) return [hit.homeKey, hit.awayKey];
  return null;
}
const HLS_RE = /^\/wk\/(?:hls|stream\.m3u8)$/i;
// Worldkoora exposes "البث 1..N" as redundant servers for the SAME channel in a
// slot. We probe them in order so a dead/blank server this game falls over to a
// live one WITHIN the same slot (never to a different channel/slot).
const VIP_SERVER_COUNT = 4;
// Hard caps so VIP pages never hang on a dead CDN during deep probes.
const FETCH_TIMEOUT_MS = 4500;
const PROBE_TIMEOUT_MS = 5000;
const VIP_RESOLVE_DEADLINE_MS = 6000;

// dlhd (daddylive) 24/7 source — fully isolated from the worldkoora /wk/ path.
// dlhd.pk 301-redirects to dlhd.st (2026-07 domain move); the old host breaks
// every stream-{id}.php resolve, so point straight at the live domain.
const DLHD_BASE = "https://dlhd.st";
const DL_EMBED_RE = /^\/dl\/(\d{1,6})\/?$/;  // /dl/{channelId} -> clean player page
const LAB_DL_EMBED_RE = /^\/lab\/dl\/(\d{1,6})\/?$/i;  // experimental lab — dlhd premiumtv iframe
const DL_HLS_RE = /^\/dl\/hls$/i;            // signed HLS proxy for dlhd streams

// Stable dlhd.pk 24/7 channel ids, keyed by our channel id. Each entry is an
// ordered list of dlhd stream-{id}.php sources to probe — first live mirror wins
// a slot in the VIP mirror pool. Sourced from dlhd.pk/24-7-channels.php (2026-07).
//
// Arabic beIN MAX 1–4 do NOT exist as separate dlhd entries. dlhd only lists
// "beIN SPORTS MAX AR" (597). When 597's CDN is down, MAX pages fall back to the
// matching beIN Sports Arabic 24/7 feed (91–95) so the channel still has stable
// Arabic sports backup. worldkoora vip1/vip2 remain primary for live MAX matches.
const DLHD_CHANNEL_MIRROR_IDS = {
  "bein-sports-1": [91, 92, 94, 95],
  "bein-sports-2": [92, 91, 94, 95],
  "bein-sports-3": [93, 92, 94],
  "bein-sports-4": [94, 92, 95, 91],
  "bein-max-1": [597, 91, 92, 94, 95],
  "bein-max-2": [597, 92, 91, 94, 95],
  "bein-max-3": [597, 94, 92, 95, 91],
  "bein-max-4": [597, 95, 94, 92, 91],
};

// When a channel's own mirrors are dead, these 24/7 dlhd feeds are probed as
// extra same-pool fallbacks (Brazil MAX 1 night: 91/92/94 often carry live WC).
const GLOBAL_DLHD_FALLBACK_IDS = [92, 94, 95, 91];

// Primary dlhd id per channel (first mirror). Used for HEAD /dl/{id} shortcuts.
const DLHD_CHANNEL_IDS = Object.fromEntries(
  Object.entries(DLHD_CHANNEL_MIRROR_IDS).map(([ch, ids]) => [ch, ids[0]])
);

// Extra same-channel HLS mirrors from other public sources (e.g. kooracitty),
// keyed by our channel id. Each entry is a direct HLS/master URL. They join the
// SAME smoothness-ranked, deep-liveness-verified pool as worldkoora/dlhd, so a
// dead entry is simply dropped. Empty by default.
//
// HOW TO ADD A KOORACITTY (or similar) MIRROR: kooracitty injects its player
// client-side and serves no stream markup to servers, so the URL can't be
// resolved headlessly. Open a live kooracitty match in a browser, and from
// DevTools > Network copy the actual `*.m3u8` request URL, then add it here:
//   "bein-sports-1": [{ url: "https://.../index.m3u8", kind: "plain" }],
// `kind` controls the CDN fetch headers: "plain" (UA only), "wk" (worldkoora
// Referer/Origin), or "dl" (no Referer/Origin).
const EXTRA_CHANNEL_STREAMS = {};

// Fallback trust for UN-signed ?u= values only (direct hits / legacy links).
// Signed URLs minted by this worker bypass this list entirely, so it no longer
// needs to be edited every time worldkoora rotates its CDN host.
const ALLOWED_STREAM_HOST =
  /(^|\.)((heinzromanigi|teworld|smarop|golatooa|554564\.sbs|bikriza\.site|futeure\.space|syria-llive\.live|ttvnw\.net|playlist\.ttvnw\.net)\.[a-z0-9.-]+|(cdn[0-9]?\.)?heinzromanigi1\.xyz|za\.teworld\.online|we\.smarop\.store|mashy\.[a-z0-9.-]+|1\.554564\.sbs|mev\.futeure\.space|eun[0-9]+\.playlist\.ttvnw\.net)$/i;

// Last-known-good streams per VIP slot/serv when upstream HTML is blank or stale.
// Do NOT pin promo-loop slates here (e.g. egcity1 yallakora redirect loops).
const LAST_KNOWN_VIP_STREAMS = {
  vip1: {
    3: [{ source: "https://1.554564.sbs/hls/1/stream.m3u8", player: "clappr" }],
  },
};

// Upstream promo/rehearsal slates — never serve these even if the manifest parses.
const BLOCKED_STREAM_PATTERNS = [/egcity1\.m3u8/i];

// Verified-live Twitch cache — keyed by slot + beIN channel (or match id).
const LAST_KNOWN_TWITCH_CHANNELS = {};

const HIDE_OVERLAY_STYLE = `<style id="kz-no-ads">
.aplr-fxd-bnr,#aplr-fixedban,.aplr-menu,ul.aplr-menu,.aplr-action,.aplr-exbtns,
[class^="agl-"],[class*=" agl-"],[id^="agl-"],
.aplr-ad,.aplr-preroll,.video-ad,.vjs-ad,.ima-ad-container,.google-ad,.ad-container,
[id*="ad" i],[class*="ad-" i],[class*="-ad" i],[class*="ads" i],[class*="popup" i],[id*="popup" i],
a[target="_blank"],iframe[src*="doubleclick"],iframe[src*="googlesyndication"],iframe[src*="popads"],iframe[src*="propeller"],iframe[src*="adsterra"],
.aplr-embed-holder,.aplr-embed-visible,.aplr-site-name{display:none!important;visibility:hidden!important;pointer-events:none!important;opacity:0!important}
</style>`;

const EMBED_SHIM = `<script id="kz-embed-shim">
(function(){
  var AD_RE=/cosetengarb|corruptioneasiest|histats|acscdn|aclib|doubleclick|googlesyndication|popads|propeller|exoclick|adsterra|mgid|taboola|outbrain|cloudflareinsights|pubads|googletagmanager|google-analytics|imasdk|advertising|\/ads\//i;
  function noop(){return null;}
  try{window.open=noop;}catch(e){}
  try{Object.defineProperty(window,'open',{configurable:true,writable:false,value:noop});}catch(e){}
  window.AplrDevprotocol='0';
  window.AplrDevredirect='';
  window.AplrPopUp=noop;
  window.openLink=noop; window.PopUp=noop; window.popunder=noop;
  function badUrl(u){u=String(u||'');return !u||AD_RE.test(u)||/^javascript:/i.test(u);}
  function kill(el){try{el.remove();}catch(e){try{el.style.setProperty('display','none','important');el.style.setProperty('pointer-events','none','important');}catch(_){}}}
  function clean(){
    try{
      document.querySelectorAll('script[src],iframe[src],img[src],a[href]').forEach(function(el){
        var u=el.getAttribute('src')||el.getAttribute('href')||'';
        if(badUrl(u)) kill(el);
      });
      document.querySelectorAll('a[target="_blank"],[onclick*="open" i],[onclick*="popup" i],[class*="popup" i],[id*="popup" i]').forEach(kill);
      document.querySelectorAll('body > div, body > a').forEach(function(el){
        var cs=getComputedStyle(el), zi=parseInt(cs.zIndex||'0',10), r=el.getBoundingClientRect();
        if((cs.position==='fixed'||cs.position==='absolute')&&zi>=999&&(r.width>innerWidth*.35||r.height>innerHeight*.25)&&!el.querySelector('video,.clappr-container,.jwplayer')) kill(el);
      });
    }catch(e){}
  }
  document.addEventListener('click',function(ev){
    var a=ev.target&&ev.target.closest&&ev.target.closest('a');
    if(a&&(a.target==='_blank'||badUrl(a.href)||/open|popup/i.test(a.getAttribute('onclick')||''))){ev.preventDefault();ev.stopImmediatePropagation();return false;}
  },true);
  document.addEventListener('DOMContentLoaded',clean);
  setInterval(clean,800);
  function wrapPlayer(Orig){
    if(!Orig||Orig.__kzPatched)return Orig;
    function Patched(opts){
      opts=opts||{};
      var src=String(opts.source||'');
      if(src&&!opts.mimeType&&(/\/wk\/(hls|stream\.m3u8)/.test(src)||/\.m3u8/i.test(src.split('?')[0]))){
        opts.mimeType='application/vnd.apple.mpegurl';
      }
      opts.ads=false; opts.adSchedule={}; opts.advertising={};
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
    if (/agl006\.host|aplr-fxd-bnr|cvt-s\d*\.agl|jnbhi\.com|nuvolda\.store/i.test(block)) return "";
    if (/AplrDevprotocol|ConsoleBan\.init|ConsoleBan\.prototype|AplrPopUp/i.test(block)) return "";
    return block;
  });
}

function hlsProxyUrl(target, origin, sig, basePath) {
  const path = basePath || "/wk/stream.m3u8";
  const signature = sig ? `&sig=${encodeURIComponent(sig)}` : "";
  return `${origin}${path}?u=${encodeURIComponent(target)}${signature}`;
}

function fetchWithTimeout(url, init, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const merged = { ...init, signal: controller.signal };
  return fetch(url, merged).finally(() => clearTimeout(timer));
}

// Edge-cache GET responses to cut Worker invocations (Error 1027 = 100k/day free limit).
async function withEdgeCache(request, ttlSeconds, producer) {
  if (request.method !== "GET") return producer();
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await producer();
  if (!res || res.status !== 200) return res;
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
  const cached = new Response(res.body, { status: 200, headers });
  await cache.put(request, cached.clone());
  return cached;
}

function manifestIsStale(text) {
  const dates = [...String(text || "").matchAll(/#EXT-X-PROGRAM-DATE-TIME:([^\n]+)/gi)]
    .map((m) => Date.parse(m[1]))
    .filter((ms) => !Number.isNaN(ms));
  if (!dates.length) return false;
  return Date.now() - Math.max(...dates) > 5 * 60 * 1000;
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
      const abs = resolveStreamUrl(trimmed, manifestUrl);
      if (!shouldProxyStream(abs, origin)) return trimmed;
      const sig = await signTarget(abs, secret);
      return hlsProxyUrl(abs, origin, sig, basePath);
    })
  );
  return rewritten.join("\n");
}

function isHlsUrl(url) {
  return /^https?:\/\//i.test(String(url || "")) && /\.m3u8(?:\?|#|$)/i.test(String(url || ""));
}

function isBlockedStreamUrl(url) {
  return BLOCKED_STREAM_PATTERNS.some((re) => re.test(String(url || "")));
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
    if (isHlsUrl(source) && !isBlockedStreamUrl(source)) out.push({ source, player: m[2] || "clappr" });
  }
  for (const m of text.matchAll(/<(?:source|video)\b[^>]*\ssrc=(["'])(https?:\/\/[^"']+)["']/gi)) {
    if (isHlsUrl(m[2]) && !isBlockedStreamUrl(m[2])) out.push({ source: m[2], player: "clappr" });
  }
  for (const m of text.matchAll(/source\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi)) {
    if (isHlsUrl(m[1]) && !isBlockedStreamUrl(m[1])) out.push({ source: m[1], player: "clappr" });
  }
  for (const m of text.matchAll(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi)) {
    if (isHlsUrl(m[1]) && !isBlockedStreamUrl(m[1])) out.push({ source: m[1], player: "clappr" });
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
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml",
        Referer: WORLDKOORA + "/",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
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

function parseTargetDuration(manifest) {
  const m = manifest.match(/#EXT-X-TARGETDURATION:\s*([0-9.]+)/i);
  return m ? Number(m[1]) : null;
}

// Geo/IP gate signatures — master playlist OK but child playlist or segment blocked.
const GEO_BLOCK_STATUSES = new Set([403, 451, 410]);

function isGeoBlockStatus(status) {
  return GEO_BLOCK_STATUSES.has(Number(status));
}

function geoSuspectFromSteps(steps) {
  if (!steps || !steps.length) return false;
  const masterOk = steps.some((s) => s.step === "master" && s.ok);
  if (!masterOk) return steps.some((s) => s.step === "master" && s.status === 451);
  return steps.some((s) => (s.step === "variant" || s.step === "segment") && isGeoBlockStatus(s.status));
}

function streamVerdictFromMirrors(mirrors) {
  const working = mirrors.filter((m) => m.playable);
  const geo = mirrors.filter((m) => m.geoSuspect);
  const dead = mirrors.filter((m) => !m.playable && !m.geoSuspect);
  if (working.length) return "working";
  if (geo.length && !dead.length) return "likely_geo_block";
  if (geo.length && dead.length) return "mixed_geo_and_dead";
  if (geo.length) return "likely_geo_block";
  return "likely_dead";
}

// Full HLS chain probe with step-by-step diagnosis (master → variant → segment).
// Returns { ok, ms, score, soft?, geoSuspect?, failure?, steps[] }.
async function probeHlsChain(source, kind, request) {
  const headers = streamFetchHeaders(kind, request);
  const started = Date.now();
  const steps = [];
  const finish = (fields) => ({
    ms: Date.now() - started,
    steps,
    geoSuspect: geoSuspectFromSteps(steps),
    ...fields,
  });

  try {
    const res = await fetchWithTimeout(source, { headers, redirect: "follow" }, PROBE_TIMEOUT_MS);
    steps.push({ step: "master", status: res.status, ok: res.ok });
    if (!res.ok) {
      return finish({
        ok: false,
        failure: res.status === 451 ? "geo_451" : "master_fail",
      });
    }
    const text = await res.text();
    if (!text.trimStart().startsWith("#EXTM3U")) {
      return finish({ ok: false, failure: "not_m3u8" });
    }
    if (manifestIsStale(text)) {
      return finish({ ok: false, failure: "stale_manifest" });
    }

    let mediaManifestUrl = source;
    let mediaText = text;
    if (/#EXT-X-STREAM-INF/i.test(text)) {
      const variant = firstMediaLine(text);
      if (!variant) return finish({ ok: false, failure: "no_variant_line" });
      const variantUrl = resolveStreamUrl(variant, source);
      const vres = await fetchWithTimeout(variantUrl, { headers, redirect: "follow" }, PROBE_TIMEOUT_MS);
      steps.push({ step: "variant", status: vres.status, ok: vres.ok, url: variantUrl });
      if (!vres.ok) {
        const geoSuspect = isGeoBlockStatus(vres.status);
        return finish({
          ok: false,
          failure: geoSuspect ? "variant_block" : "variant_fail",
          geoSuspect,
        });
      }
      mediaText = await vres.text();
      if (!mediaText.trimStart().startsWith("#EXTM3U")) {
        return finish({ ok: false, failure: "variant_not_m3u8", soft: true });
      }
      if (manifestIsStale(mediaText)) {
        return finish({ ok: false, failure: "stale_variant", soft: true });
      }
      mediaManifestUrl = variantUrl;
    }

    const seg = firstMediaLine(mediaText);
    if (!seg) {
      return finish({ ok: true, score: 3000, soft: true });
    }
    const segUrl = resolveStreamUrl(seg, mediaManifestUrl);
    if (isHlsUrl(segUrl)) {
      const ms = Date.now() - started;
      const segCount = (mediaText.match(/#EXTINF/gi) || []).length;
      const targetDur = parseTargetDuration(mediaText) || 6;
      const bufferPenalty = segCount >= 3 ? 0 : 400;
      const targetPenalty = targetDur > 6 ? (targetDur - 6) * 80 : 0;
      return finish({ ok: true, score: ms + bufferPenalty + targetPenalty });
    }

    const sres = await fetchWithTimeout(
      segUrl,
      { headers: { ...headers, Range: "bytes=0-2047" }, redirect: "follow" },
      PROBE_TIMEOUT_MS
    );
    steps.push({ step: "segment", status: sres.status, ok: sres.status === 200 || sres.status === 206, url: segUrl });
    if (!(sres.status === 200 || sres.status === 206)) {
      const geoSuspect = isGeoBlockStatus(sres.status);
      return finish({
        ok: false,
        failure: geoSuspect ? "segment_block" : "segment_fail",
        geoSuspect,
      });
    }
    const ctype = (sres.headers.get("Content-Type") || "").toLowerCase();
    if (ctype.includes("text/html")) {
      return finish({ ok: false, failure: "segment_html", soft: true });
    }
    let segBytesOk = true;
    if (sres.body) {
      const reader = sres.body.getReader();
      const { value, done } = await reader.read();
      try { await reader.cancel(); } catch { /* noop */ }
      segBytesOk = !done && !!value && value.byteLength > 0;
    } else {
      const buf = await sres.arrayBuffer();
      segBytesOk = buf.byteLength > 0;
    }
    if (!segBytesOk) {
      return finish({ ok: false, failure: "segment_empty", soft: true });
    }

    const ms = Date.now() - started;
    const segCount = (mediaText.match(/#EXTINF/gi) || []).length;
    const targetDur = parseTargetDuration(mediaText) || 6;
    const bufferPenalty = segCount >= 3 ? 0 : 400;
    const targetPenalty = targetDur > 6 ? (targetDur - 6) * 80 : 0;
    return finish({ ok: true, score: ms + bufferPenalty + targetPenalty });
  } catch {
    return finish({ ok: false, failure: "probe_error" });
  }
}

// DEEP liveness + smoothness probe: walk master -> variant -> first segment and
// actually pull segment bytes. Geo-blocked chains (master 200, variant/segment 403/451)
// return ok:false + geoSuspect:true — no more soft-approving dead phantemlis mirrors.
// Returns { ok, ms, score, soft?, geoSuspect?, failure? } — lower score = smoother.
async function streamProbe(source, kind, request) {
  const chain = await probeHlsChain(source, kind, request);
  if (chain.ok) {
    return {
      ok: true,
      ms: chain.ms,
      score: chain.score,
      soft: chain.soft || false,
    };
  }
  if (chain.geoSuspect) {
    return {
      ok: false,
      geoSuspect: true,
      failure: chain.failure,
      ms: chain.ms,
    };
  }
  if (chain.soft && await manifestLooksLive(source, kind, request)) {
    return { ok: true, ms: chain.ms || 9999, score: 9000, soft: true };
  }
  return { ok: false, failure: chain.failure, ms: chain.ms };
}

async function manifestLooksLive(source, kind, request) {
  try {
    const res = await fetchWithTimeout(
      source,
      { headers: streamFetchHeaders(kind, request), redirect: "follow" },
      PROBE_TIMEOUT_MS
    );
    if (!res.ok) return false;
    const text = await res.text();
    return (
      text.trimStart().startsWith("#EXTM3U") &&
      /#EXT(?:INF|-X-STREAM-INF)/i.test(text) &&
      !manifestIsStale(text)
    );
  } catch {
    return false;
  }
}

async function hlsManifestIsLive(source, request) {
  try {
    const res = await fetchWithTimeout(
      source,
      {
        headers: {
          "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
          Accept: "application/vnd.apple.mpegurl,*/*",
          Referer: WORLDKOORA + "/",
        },
        redirect: "follow",
      },
      PROBE_TIMEOUT_MS
    );
    if (!res.ok) return false;
    const text = await res.text();
    return text.trimStart().startsWith("#EXTM3U") && !manifestIsStale(text);
  } catch {
    return false;
  }
}

function injectPlayerScript(html, source, player, origin, secret) {
  return signTarget(source, secret).then((sig) => {
    const proxied = hlsProxyUrl(source, origin, sig);
    const script = `<script>AlbaPlayerControl('${btoa(proxied)}','${player || "clappr"}')</script>`;
    const content = /(<div\b[^>]*class=["'][^"']*\baplr-player-content\b[^"']*["'][^>]*>)([\s\S]*?)(<\/div>)/i;
    if (content.test(html)) {
      return html.replace(content, (_m, open, _inner, close) => `${open}${script}${close}`);
    }
    return html.replace(/<\/body>/i, script + "</body>");
  });
}

async function resolveLastKnownVipStream(html, slot, origin, secret, request) {
  if (extractHlsCandidates(html).length) return html;
  const serv = Number(new URL(request.url).searchParams.get("serv") || 1);
  const candidates = (LAST_KNOWN_VIP_STREAMS[slot] && LAST_KNOWN_VIP_STREAMS[slot][serv]) || [];
  for (const candidate of candidates) {
    if (isHlsUrl(candidate.source) && await hlsManifestIsLive(candidate.source, request)) {
      return injectPlayerScript(html, candidate.source, candidate.player, origin, secret);
    }
  }
  return html;
}

function stripExistingPlayerControls(html) {
  return String(html || "")
    .replace(/AlbaPlayerControl\('[^']*','[^']*'\)/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?AlbaPlayerControl[\s\S]*?<\/script>/gi, "");
}

async function healDeadVipStream(html, slot, origin, secret, request) {
  const candidates = extractHlsCandidates(html);
  if (candidates.length && (await hlsManifestIsLive(candidates[0].source, request))) return html;

  const currentServ = Number(new URL(request.url).searchParams.get("serv") || 1);
  for (const serv of [3, 2, 1]) {
    if (serv === currentServ) continue;
    const fallbackSources = [];
    const pageHtml = await fetchPlayerHtml(`${WORLDKOORA}/albaplayer/${slot}/?serv=${serv}`, request);
    if (pageHtml) {
      const resolved = await resolvePlayableSourceFromHtml(pageHtml, request);
      if (resolved?.source) fallbackSources.push(resolved);
    }
    const known = (LAST_KNOWN_VIP_STREAMS[slot] && LAST_KNOWN_VIP_STREAMS[slot][serv]) || [];
    fallbackSources.push(...known);

    for (const item of fallbackSources) {
      if (!item?.source || !isHlsUrl(item.source)) continue;
      if (!(await hlsManifestIsLive(item.source, request))) continue;
      return injectPlayerScript(
        stripExistingPlayerControls(html),
        item.source,
        item.player || "clappr",
        origin,
        secret
      );
    }
  }
  return html;
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

function twitchParentDomains(origin) {
  const parents = new Set(["korazero.com", "www.korazero.com"]);
  try {
    const host = new URL(origin).hostname;
    if (host) parents.add(host);
    if (host !== "localhost") parents.add("localhost");
  } catch {
    /* noop */
  }
  return [...parents];
}

function twitchEmbedUrl(channel, origin) {
  const ch = String(channel || "").replace(/[^a-zA-Z0-9_]/g, "");
  const u = new URL("https://player.twitch.tv/");
  u.searchParams.set("channel", ch);
  for (const p of twitchParentDomains(origin)) u.searchParams.append("parent", p);
  u.searchParams.set("autoplay", "true");
  // muted=true so browsers allow autoplay without error toasts; unmute inside the iframe.
  u.searchParams.set("muted", "true");
  return u.toString();
}

const TWITCH_LOGIN_BLOCKLIST = new Set([
  "directory", "popout", "settings", "videos", "clips", "downloads", "about", "schedule", "search", "signup",
]);
let _twitchConfigCache = null;
let _twitchHelixToken = { token: "", exp: 0 };

function sanitizeTwitchLogin(raw) {
  const ch = String(raw || "").replace(/[^a-zA-Z0-9_]/g, "");
  if (!ch || ch.length < 2 || TWITCH_LOGIN_BLOCKLIST.has(ch.toLowerCase())) return null;
  return ch;
}

function extractAllTwitchChannels(html) {
  const out = [];
  const add = (raw) => {
    const ch = sanitizeTwitchLogin(raw);
    if (ch && !out.includes(ch)) out.push(ch);
  };
  const s = String(html || "");
  const patterns = [
    /player\.twitch\.tv\/[^"'<>]*?[?&]channel=([a-zA-Z0-9_]+)/gi,
    /(?:https?:)?\/\/(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)(?:[/"'\s>]|$)/gi,
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(s)) !== null) add(m[1]);
  }
  for (const b64 of s.matchAll(/AlbaPlayerControl\('([A-Za-z0-9+/=]*)'/g)) {
    try {
      for (const ch of extractAllTwitchChannels(atob(b64[1]))) add(ch);
    } catch { /* noop */ }
  }
  return out;
}

function extractTwitchChannel(html) {
  const list = extractAllTwitchChannels(html);
  return list[0] || null;
}

async function loadTwitchConfig(env) {
  if (_twitchConfigCache) return _twitchConfigCache;
  try {
    const req = new Request(new URL("/assets/data/twitch-channels.json", "https://korazero.com"));
    const res = env && env.ASSETS ? await env.ASSETS.fetch(req) : null;
    if (res && res.ok) {
      _twitchConfigCache = await res.json();
      return _twitchConfigCache;
    }
  } catch { /* noop */ }
  _twitchConfigCache = { slots: { vip1: { candidates: [] }, vip2: { candidates: [] } }, globalCandidates: [] };
  return _twitchConfigCache;
}

async function twitchHelixAppToken(env) {
  const clientId = env && env.TWITCH_CLIENT_ID;
  const secret = env && env.TWITCH_CLIENT_SECRET;
  if (!clientId || !secret) return null;
  const now = Date.now();
  if (_twitchHelixToken.token && now < _twitchHelixToken.exp - 60_000) return _twitchHelixToken.token;
  try {
    const res = await fetchWithTimeout(
      `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`,
      { method: "POST" },
      6000
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.access_token) return null;
    _twitchHelixToken = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) * 1000 };
    return _twitchHelixToken.token;
  } catch {
    return null;
  }
}

async function twitchHelixLiveMap(logins, env) {
  const token = await twitchHelixAppToken(env);
  const clientId = env && env.TWITCH_CLIENT_ID;
  if (!token || !clientId || !logins.length) return null;
  const q = logins.map((l) => `user_login=${encodeURIComponent(l)}`).join("&");
  try {
    const res = await fetchWithTimeout(`https://api.twitch.tv/helix/streams?${q}`, {
      headers: { "Client-ID": clientId, Authorization: `Bearer ${token}` },
    }, 6000);
    if (!res.ok) return null;
    const data = await res.json();
    const live = new Set();
    for (const row of data.data || []) {
      if (row.user_login) live.add(String(row.user_login).toLowerCase());
    }
    const out = new Map();
    for (const login of logins) out.set(login, live.has(String(login).toLowerCase()));
    return out;
  } catch {
    return null;
  }
}

async function twitchHelixGet(path, env) {
  const token = await twitchHelixAppToken(env);
  const clientId = env && env.TWITCH_CLIENT_ID;
  if (!token || !clientId) return null;
  try {
    const res = await fetchWithTimeout(`https://api.twitch.tv/helix/${path}`, {
      headers: { "Client-ID": clientId, Authorization: `Bearer ${token}` },
    }, 6000);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function twitchHelixLiveStreams(logins, env) {
  const uniq = [];
  for (const raw of logins) {
    const ch = sanitizeTwitchLogin(raw);
    if (ch && !uniq.includes(ch)) uniq.push(ch);
  }
  if (!uniq.length) return [];
  const q = uniq.map((l) => `user_login=${encodeURIComponent(l)}`).join("&");
  const data = await twitchHelixGet(`streams?${q}`, env);
  return (data && data.data) || [];
}

function twitchCacheKey(slot, channelId, match) {
  if (match && match.id) return `${slot}:${match.id}`;
  if (channelId) return `${slot}:${channelId}`;
  return slot;
}

function scoreStreamTitleForMatch(title, match) {
  if (!match || !title) return 0;
  const t = String(title).toLowerCase();
  let score = 0;
  const terms = [
    match.home,
    match.away,
    match.homeAbbr,
    match.awayAbbr,
    match.channel,
    match.league,
  ].filter(Boolean);
  for (const term of terms) {
    const s = String(term).toLowerCase().trim();
    if (s.length >= 3 && t.includes(s)) score += 10;
    else if (s.length >= 2 && t.includes(s)) score += 5;
  }
  if (/bein|بين|max|كأس|world\s*cup|fifa/i.test(t)) score += 3;
  return score;
}

// Reject facecam / watch-party streams — keep TV-style rebroadcasts only.
const TWITCH_FACE_GAMES = new Set([
  "just chatting",
  "irl",
  "special events",
  "talk shows",
  "pools, hot tubs, and beaches",
  "asmr",
  "co-working",
  "music",
  "art",
]);
const TWITCH_SPORTS_GAME_RE = /sport|fifa|football|soccer|fc\s*\d|pes|nba|nfl|madden/i;
const TWITCH_FACE_TITLE_RE =
  /face\s*cam|facecam|web\s*cam|webcam|watch\s*(party|along)|watchalong|reaction|reacting|vlog|podcast|ردة\s*فعل|كاميرا|كام\b|مع\s*كام|تحليل|ستوديو|talking|دردشة|شات\b|chatting/i;
const TWITCH_PURE_TITLE_RE =
  /bein|بين\s*ماكس|bein\s*max|max\s*\d|مباراة|ملخص|بث\s*مباشر|كأس\s*العالم|world\s*cup|fifa|\bvs\b|×|v\s*[sS]\b|\d+\s*[-–]\s*\d+/i;

function isPureTvTwitchStream(stream) {
  if (!stream) return false;
  const game = String(stream.game_name || "").toLowerCase().trim();
  if (game && TWITCH_FACE_GAMES.has(game)) return false;

  const title = String(stream.title || "");
  if (TWITCH_FACE_TITLE_RE.test(title)) return false;

  for (const tag of stream.tags || []) {
    const t = String(tag).toLowerCase();
    if (/facecam|webcam|watchparty|watchalong|reaction|react|irl|justchatting/.test(t)) return false;
  }

  if (game && TWITCH_SPORTS_GAME_RE.test(game)) return true;
  if (TWITCH_PURE_TITLE_RE.test(title)) return true;

  // Unknown category + generic title → treat as facecam (common for watch-alongs).
  return false;
}

function scoreTwitchStreamCandidate(stream, match, upstreamFirst) {
  if (!isPureTvTwitchStream(stream)) return -9999;
  const login = sanitizeTwitchLogin(stream.user_login);
  if (!login) return -9999;

  let score = match ? scoreStreamTitleForMatch(stream.title, match) : 0;
  if (upstreamFirst.includes(login)) score += 50;
  if (TWITCH_SPORTS_GAME_RE.test(String(stream.game_name || ""))) score += 15;
  score += Math.min(10, Math.floor((Number(stream.viewer_count) || 0) / 500));
  if (!upstreamFirst.includes(login)) score -= 25;
  return score;
}

async function resolveMatchForTwitch(request, env, channelId) {
  const incoming = new URL(request.url);
  const matchId = incoming.searchParams.get("match");
  const origin = incoming.origin;
  const matches = await loadTodayMatches(env, origin);
  if (matchId) {
    const hit = matches.find((m) => m.id === matchId);
    if (hit) return hit;
  }
  if (channelId) {
    const liveOnCh = matches.find((m) => m.channelId === channelId && m.status === "live");
    if (liveOnCh) return liveOnCh;
  }
  return null;
}

async function discoverTwitchSearchLogins(match, seedLogins, env) {
  const out = new Set();
  for (const raw of seedLogins) {
    const ch = sanitizeTwitchLogin(raw);
    if (ch) out.add(ch);
  }
  if (!match) return [...out];
  // Broad team-name search finds facecam watch-parties — only search broadcaster-style terms.
  const queries = [
    match.channel || "",
    "beIN MAX Arabic",
    "beIN Sports Arabic",
    "beIN MAX live",
  ].filter((q) => q && q.length >= 3);
  for (const q of queries) {
    const data = await twitchHelixGet(`search/channels?query=${encodeURIComponent(q)}&first=8`, env);
    for (const row of (data && data.data) || []) {
      const login = sanitizeTwitchLogin(row.broadcaster_login);
      if (login) out.add(login);
    }
  }
  return [...out];
}

async function pickLiveTwitchForMatch(match, upstreamFirst, configCandidates, env) {
  const helixReady = !!(env && env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET);
  if (!helixReady) return upstreamFirst[0] || null;

  const seeds = [];
  const push = (ch) => {
    const s = sanitizeTwitchLogin(ch);
    if (s && !seeds.includes(s)) seeds.push(s);
  };
  for (const ch of upstreamFirst) push(ch);
  for (const ch of configCandidates) push(ch);

  const searchLogins = await discoverTwitchSearchLogins(match, seeds, env);
  const streams = await twitchHelixLiveStreams(searchLogins, env);
  const pureStreams = streams.filter(isPureTvTwitchStream);
  if (!pureStreams.length) return null;

  let bestLogin = null;
  let bestScore = -1;
  for (const s of pureStreams) {
    const total = scoreTwitchStreamCandidate(s, match, upstreamFirst);
    if (total > bestScore) {
      bestScore = total;
      bestLogin = sanitizeTwitchLogin(s.user_login);
    }
  }

  const minScore = match ? 8 : 0;
  if (bestScore < minScore) {
    const upstreamPure = pureStreams
      .map((s) => sanitizeTwitchLogin(s.user_login))
      .filter((login) => login && upstreamFirst.includes(login));
    if (upstreamPure.length === 1) return upstreamPure[0];
    return null;
  }
  return bestLogin;
}

async function pickLiveTwitchChannel(candidates, env, upstreamFirst = []) {
  const uniq = [];
  for (const raw of candidates) {
    const ch = sanitizeTwitchLogin(raw);
    if (ch && !uniq.includes(ch)) uniq.push(ch);
  }
  if (!uniq.length) return null;
  const streams = await twitchHelixLiveStreams(uniq, env);
  const pureStreams = streams.filter(isPureTvTwitchStream);
  if (!pureStreams.length) return null;

  let bestLogin = null;
  let bestScore = -1;
  for (const s of pureStreams) {
    const total = scoreTwitchStreamCandidate(s, null, upstreamFirst);
    if (total > bestScore) {
      bestScore = total;
      bestLogin = sanitizeTwitchLogin(s.user_login);
    }
  }
  return bestLogin;
}

async function scrapeTwitchUpstream(request, slot, htmlHints) {
  const discovered = [];
  const add = (ch) => {
    const s = sanitizeTwitchLogin(ch);
    if (s && !discovered.includes(s)) discovered.push(s);
  };
  const hints = Array.isArray(htmlHints) ? htmlHints : [htmlHints];
  for (const html of hints) {
    if (!html) continue;
    for (const ch of extractAllTwitchChannels(html)) add(ch);
  }
  const pages = await Promise.all([1, 3, 2, 4].map((serv) => fetchVipServerHtml(request, slot, serv)));
  for (const page of pages) {
    if (!page.html) continue;
    for (const ch of extractAllTwitchChannels(page.html)) add(ch);
  }
  return discovered;
}

// Canonical Twitch resolver: upstream scrape → Helix title match per game → config fallbacks.
async function resolveTwitchChannel(request, slot, htmlHints, env, channelId) {
  const config = await loadTwitchConfig(env);
  const slotCfg = (config.slots && config.slots[slot]) || {};
  const upstreamFirst = await scrapeTwitchUpstream(request, slot, htmlHints);
  const match = await resolveMatchForTwitch(request, env, channelId);
  const configCandidates = [
    ...(slotCfg.candidates || []),
    ...(config.globalCandidates || []),
  ];
  const cacheKey = twitchCacheKey(slot, channelId, match);
  const helixReady = !!(env && env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET);

  const candidates = [];
  const push = (ch) => {
    const s = sanitizeTwitchLogin(ch);
    if (s && !candidates.includes(s)) candidates.push(s);
  };
  for (const ch of upstreamFirst) push(ch);
  for (const ch of configCandidates) push(ch);
  if (helixReady) push(LAST_KNOWN_TWITCH_CHANNELS[cacheKey]);

  let live = null;
  if (helixReady) {
    live = await pickLiveTwitchForMatch(match, upstreamFirst, configCandidates, env);
    if (!live) live = await pickLiveTwitchChannel(candidates, env, upstreamFirst);
  } else if (upstreamFirst.length) {
    live = upstreamFirst[0];
  }

  if (live) LAST_KNOWN_TWITCH_CHANNELS[cacheKey] = live;
  else delete LAST_KNOWN_TWITCH_CHANNELS[cacheKey];
  return live;
}

function fixTwitchEmbedParents(html, origin) {
  const host = twitchParentDomains(origin)[0];
  return String(html || "")
    .replace(/(player\.twitch\.tv\/\?[^"'<>]*?)parent=[^&"'<>]+/gi, `$1parent=${host}`)
    .replace(/(https:\/\/player\.twitch\.tv\/[^"'<>]*?)parent=[^&"'<>]+/gi, `$1parent=${host}`);
}

// Standard Twitch iframe embed — same as upstream worldkoora. Avoids Twitch.Player JS
// error toasts ("unplayable" + dismiss X) and shows the real player chrome.
function cleanTwitchPlayerHtml(channel, origin) {
  const src = twitchEmbedUrl(channel, origin);
  const ch = String(channel || "").replace(/[^a-zA-Z0-9_]/g, "");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KoraZero</title>
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden}
.kz-twitch-shell{position:relative;width:100vw;height:100vh;background:#000}
.kz-twitch-frame{width:100%;height:100%;border:0;background:#000;display:block}
</style>
</head><body>
<div class="kz-twitch-shell">
  <iframe class="kz-twitch-frame" src="${src}" title="Twitch — ${ch}"
    allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" loading="eager"></iframe>
</div>
</body></html>`;
}


function twitchPlayerResponse(channel, origin, htmlHeaders) {
  return new Response(cleanTwitchPlayerHtml(channel, origin), {
    status: 200,
    headers: {
      ...htmlHeaders,
      "X-KZ-Player": "twitch",
      "X-KZ-Twitch-Channel": channel,
    },
  });
}

async function cleanWorldkooraHtml(html, slot, origin, secret, request) {
  let out = stripBlockedScripts(html);
  out = await resolveNestedIframesInHtml(out, origin, secret, request);
  out = await healDeadVipStream(out, slot, origin, secret, request);
  out = await resolveLastKnownVipStream(out, slot, origin, secret, request);
  out = await rewriteStreamUrlsInHtml(out, origin, secret);
  out = fixTwitchEmbedParents(out, origin);
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
// hls.js tuning for third-party live HLS (worldkoora/dlhd CDNs). Based on hls.js
// docs + community guidance: smaller forward buffer, live-edge sync, playback-rate
// catch-up, and no startLoad() on non-fatal stalls (causes freeze loops — #7433).
const HLS_BOOT_FN = `function kzHlsOpts(){
  return {
    enableWorker: true,
    lowLatencyMode: false,
    startPosition: -1,
    maxBufferLength: 14,
    maxMaxBufferLength: 28,
    backBufferLength: 30,
    liveSyncDurationCount: 2,
    liveMaxLatencyDurationCount: 6,
    liveDurationInfinity: true,
    maxLiveSyncPlaybackRate: 1.35,
    highBufferWatchdogPeriod: 2,
    maxBufferHole: 0.5,
    nudgeOffset: 0.12,
    nudgeMaxRetry: 4,
    initialLiveManifestSize: 1,
    startFragPrefetch: true,
    manifestLoadingMaxRetry: 6,
    manifestLoadingTimeOut: 10000,
    levelLoadingMaxRetry: 4,
    fragLoadingMaxRetry: 6,
    fragLoadingTimeOut: 12000,
    abrEwmaFastLive: 3,
    abrEwmaSlowLive: 9,
    capLevelToPlayerSize: true,
  };
}
function kzAttachHls(v,src,onFatal){
  var hls=new Hls(kzHlsOpts());
  hls.loadSource(src); hls.attachMedia(v);
  hls.on(Hls.Events.ERROR,function(_e,d){
    if(!d||!d.fatal) return;
    if(d.type==='networkError'){
      setTimeout(function(){ try{ hls.startLoad(-1); }catch(e){ onFatal(); } }, 1000);
      return;
    }
    if(d.type==='mediaError'){
      try{ hls.recoverMediaError(); return; }catch(e){}
    }
    onFatal();
  });
  return hls;
}
function kzSoftRecover(v,hls){
  if(!hls) return;
  try{ hls.startLoad(-1); }catch(e){}
  var p=v.play&&v.play(); if(p&&p.catch)p.catch(function(){});
}
function kzWatchStall(v,hls,onStall){
  var lastCt=0, stallMs=0, softTried=false;
  var iv=setInterval(function(){
    if(v.paused||v.readyState<2){ stallMs=0; softTried=false; lastCt=v.currentTime; return; }
    if(v.currentTime>0&&Math.abs(v.currentTime-lastCt)<0.05){
      stallMs+=3000;
      if(!softTried&&stallMs>=6000){
        softTried=true;
        kzSoftRecover(v,hls);
      } else if(stallMs>=12000){
        stallMs=0; softTried=false; onStall();
      }
    } else { stallMs=0; softTried=false; }
    lastCt=v.currentTime;
  }, 3000);
  return function(){ clearInterval(iv); };
}`;

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
${HLS_BOOT_FN}
(function(){
  var v=document.getElementById('v'), sources=${JSON.stringify(list)}, i=0, hls=null, tries=0, stopStall=null;
  function pingParent(reason){
    try{
      if(window.parent&&window.parent!==window){
        window.parent.postMessage({type:'kz-alt-reload', reason:reason||'stall'}, '*');
      }
    }catch(e){}
  }
  function destroy(){ if(stopStall){ stopStall(); stopStall=null; } if(hls){ try{hls.destroy();}catch(e){} hls=null; } }
  function onStall(reason){
    pingParent(reason||'stall');
    next();
  }
  function next(){
    i=(i+1)%sources.length; tries++;
    if(tries<=sources.length*6){ setTimeout(load, 400); return; }
    pingParent('exhausted');
    tries=0;
    setTimeout(function(){ location.reload(); }, 600);
  }
  function load(){
    var src=sources[i]; if(!src) return;
    destroy();
    if(v.canPlayType('application/vnd.apple.mpegurl')){
      v.src=src; v.addEventListener('error', function(){ onStall('native-error'); }, {once:true});
    } else if(window.Hls&&window.Hls.isSupported()){
      hls=kzAttachHls(v, src, function(){ onStall('fatal'); });
      stopStall=kzWatchStall(v, hls, function(){ onStall('watch-stall'); });
    } else { v.src=src; }
    var p=v.play&&v.play(); if(p&&p.catch)p.catch(function(){});
  }
  if(!v.dataset.kzWait){
    v.dataset.kzWait='1';
    v.addEventListener('waiting', function(){ kzSoftRecover(v, hls); });
  }
  var blackMs=0;
  setInterval(function(){
    if(v.paused){ blackMs=0; return; }
    if(v.videoWidth>0&&v.readyState>=2&&v.currentTime>0){ blackMs=0; return; }
    blackMs+=5000;
    if(blackMs>=18000){ blackMs=0; onStall('black'); }
  }, 5000);
  load();
})();
</script>
</body></html>`;
}

// HLS primary + Twitch iframe side-by-side. Twitch uses the official player iframe
// (not Twitch.Player JS) so users get the normal embed UI without error toasts.
function cleanDualPlayerHtml(hlsSources, twitchChannel, origin) {
  const list = Array.isArray(hlsSources) ? hlsSources.filter(Boolean) : [hlsSources].filter(Boolean);
  const twitchSrc = twitchEmbedUrl(twitchChannel, origin);
  const ch = String(twitchChannel || "").replace(/[^a-zA-Z0-9_]/g, "");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KoraZero</title>
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:system-ui,sans-serif}
.kz-shell{display:flex;flex-direction:column;width:100vw;height:100vh}
.kz-topbar{display:flex;align-items:center;gap:8px;padding:8px 10px;background:linear-gradient(180deg,#12141c,#0a0c12);border-bottom:1px solid rgba(255,255,255,.14);flex-shrink:0;z-index:30}
.kz-tab{border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#e8ecf4;font-size:12px;font-weight:700;padding:8px 12px;border-radius:8px;cursor:pointer}
.kz-tab.on{border-color:#18e29a;background:rgba(24,226,154,.18);color:#fff}
.kz-tab[data-view="twitch"].on{border-color:#9147ff;background:rgba(145,71,255,.22)}
.kz-dual{display:flex;flex-direction:row;flex:1;min-height:0;background:#000}
.kz-hls{flex:3;min-width:0;position:relative;background:#000}
.kz-hls video{width:100%;height:100%;object-fit:contain;background:#000}
.kz-twitch-side{flex:1;min-width:0;position:relative;background:#000;border-inline-start:2px solid rgba(145,71,255,.35);display:flex;flex-direction:column}
.kz-twitch-frame{flex:1;width:100%;border:0;background:#000;display:block;min-height:0}
.kz-label{position:absolute;top:10px;right:10px;z-index:10;font-size:12px;font-weight:700;padding:6px 10px;border-radius:6px;color:#fff;pointer-events:none}
.kz-label--hls{background:rgba(24,226,154,.85);color:#04120c}
.kz-label--tw{background:rgba(145,71,255,.88)}
.kz-shell.view-hls .kz-twitch-side{display:none}
.kz-shell.view-hls .kz-hls{flex:1;border:none}
.kz-shell.view-twitch .kz-hls{display:none}
.kz-shell.view-twitch .kz-twitch-side{flex:1;border:none}
@media(max-width:900px){.kz-dual{flex-direction:column}.kz-hls{flex:3}.kz-twitch-side{flex:2;border-inline-start:0;border-top:2px solid rgba(145,71,255,.35)}}
</style>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"></script>
</head><body>
<div class="kz-shell view-split" id="kz-shell">
  <div class="kz-topbar">
    <button type="button" class="kz-tab on" data-view="split">بث مباشر + Twitch</button>
    <button type="button" class="kz-tab" data-view="hls">بث مباشر</button>
    <button type="button" class="kz-tab" data-view="twitch">Twitch</button>
  </div>
  <div class="kz-dual">
    <div class="kz-hls"><span class="kz-label kz-label--hls">بث مباشر</span><video id="v" controls autoplay muted playsinline></video></div>
    <div class="kz-twitch-side">
      <span class="kz-label kz-label--tw">Twitch</span>
      <iframe class="kz-twitch-frame" src="${twitchSrc}" title="Twitch — ${ch}"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" loading="lazy"></iframe>
    </div>
  </div>
</div>
<script>
${HLS_BOOT_FN}
(function(){
  var sources=${JSON.stringify(list)}, i=0, hls=null, tries=0, v=document.getElementById('v');
  var shell=document.getElementById('kz-shell');
  shell.querySelectorAll('.kz-tab').forEach(function(btn){
    btn.addEventListener('click', function(){
      shell.querySelectorAll('.kz-tab').forEach(function(b){ b.classList.remove('on'); });
      btn.classList.add('on');
      shell.className='kz-shell view-'+btn.dataset.view;
    });
  });
  function destroy(){ if(hls){ try{hls.destroy();}catch(e){} hls=null; } }
  function nextHls(){ i=(i+1)%sources.length; tries++; if(tries<=sources.length*6) setTimeout(loadHls,400); }
  function loadHls(){
    var src=sources[i]; if(!src) return;
    destroy();
    if(v.canPlayType('application/vnd.apple.mpegurl')){ v.src=src; v.addEventListener('error',nextHls,{once:true}); }
    else if(window.Hls&&window.Hls.isSupported()){
      hls=kzAttachHls(v, src, nextHls);
      kzWatchStall(v, hls, nextHls);
    } else { v.src=src; }
    var p=v.play&&v.play(); if(p&&p.catch)p.catch(function(){});
  }
  loadHls();
})();
</script>
</body></html>`;
}

function dualPlayerResponse(hlsSources, twitchChannel, origin, htmlHeaders, meta) {
  return new Response(cleanDualPlayerHtml(hlsSources, twitchChannel, origin), {
    status: 200,
    headers: {
      ...htmlHeaders,
      "X-KZ-Player": "dual",
      "X-KZ-Twitch-Channel": twitchChannel,
      ...(meta || {}),
    },
  });
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
  const upstreamHeaders = (() => {
    const ua = request.headers.get("User-Agent") || "Mozilla/5.0";
    try {
      const host = new URL(target).hostname;
      if (/ttvnw\.net$/i.test(host)) {
        return { "User-Agent": ua, Accept: "*/*", Referer: "https://player.twitch.tv/" };
      }
      if (/syria-llive\.live$/i.test(host)) {
        return { "User-Agent": ua, Accept: "*/*", Referer: "https://mysportv.live/" };
      }
    } catch { /* noop */ }
    return {
      "User-Agent": ua,
      Accept: "*/*",
      Referer: referer,
      Origin: WORLDKOORA,
    };
  })();
  try {
    const res = await fetch(target, {
      method: request.method,
      headers: upstreamHeaders,
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
          "Cache-Control": "public, max-age=2",
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
          "Cache-Control": "public, max-age=2",
          "Access-Control-Allow-Origin": "*",
          "X-KZ-Proxy": "hls-manifest",
        },
      });
    }

    const headers = {
      "Content-Type": segmentContentType(target) || res.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": "public, max-age=60",
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
  const incoming = new URL(request.url);
  const upstream = new URL(`${WORLDKOORA}/albaplayer/${slot}/`);
  upstream.searchParams.set("serv", String(serv));
  const ch = incoming.searchParams.get("ch");
  if (ch) upstream.searchParams.set("ch", ch);
  const matchId = incoming.searchParams.get("match");
  if (matchId) upstream.searchParams.set("match", matchId);
  try {
    const res = await fetchWithTimeout(upstream.toString(), {
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
  if (!order.includes(2)) order.push(2); // upstream "البث 1" — usual live match HLS
  for (let s = 1; s <= VIP_SERVER_COUNT; s++) if (!order.includes(s)) order.push(s);
  return order;
}

// Fast upstream HLS discovery (~2–4s): fetch all VIP servers, extract HLS, soft liveness only.
async function resolveVipSlotStreamQuick(request, slot) {
  const requestedServ = new URL(request.url).searchParams.get("serv") || 1;
  const seenSources = new Set();
  const resolvedList = [];
  let firstHtml = null;
  const pages = await Promise.all(
    vipServerOrder(requestedServ).map((serv) =>
      fetchVipServerHtml(request, slot, serv).then((page) => ({ serv, page }))
    )
  );
  for (const { serv, page } of pages) {
    if (!page.html) continue;
    if (firstHtml == null) firstHtml = page.html;
    const resolved = await resolvePlayableSourceFromHtml(page.html, request, 0, new Set());
    if (resolved && !seenSources.has(resolved.source) && !isBlockedStreamUrl(resolved.source)) {
      seenSources.add(resolved.source);
      const servBonus = serv === 2 ? -400 : serv === 4 ? -100 : 0;
      resolvedList.push({ ...resolved, serv, servBonus });
    }
  }
  const probed = await Promise.all(
    resolvedList.map(async (r) => {
      const live = await manifestLooksLive(r.source, "wk", request);
      return { r, p: { ok: live, score: (r.servBonus || 0) + (live ? 100 : 9000) } };
    })
  );
  const candidates = probed
    .filter((x) => x.p.ok)
    .sort((a, b) => a.p.score - b.p.score)
    .map((x) => ({ ...x.r, score: x.p.score }));
  return { candidates, firstHtml };
}

// Actively build a ranked pool of VERIFIED-live HLS mirrors for a slot at request
// time. Every "بث N" server of the SAME slot is resolved and liveness-checked, so
// dead CDN hosts (worldkoora rotates and kills these constantly) are dropped and
// the live ones become failover mirrors. Only servers of the SAME slot are used —
// never a different channel/slot. Returns { candidates, firstHtml }.
async function resolveVipSlotStream(request, slot) {
  const requestedServ = new URL(request.url).searchParams.get("serv") || 1;
  const seenSources = new Set();
  const resolvedList = [];
  let firstHtml = null;

  // Fetch all VIP servers in parallel — sequential fetches were blocking VIP for 10–60s.
  const pages = await Promise.all(
    vipServerOrder(requestedServ).map((serv) =>
      fetchVipServerHtml(request, slot, serv).then((page) => ({ serv, page }))
    )
  );
  for (const { serv, page } of pages) {
    if (!page.html) continue;
    if (firstHtml == null) firstHtml = page.html;
    const resolved = await resolvePlayableSourceFromHtml(page.html, request, 0, new Set());
    if (resolved && !seenSources.has(resolved.source) && !isBlockedStreamUrl(resolved.source)) {
      seenSources.add(resolved.source);
      resolvedList.push({ ...resolved, serv });
    }
    const known = (LAST_KNOWN_VIP_STREAMS[slot] && LAST_KNOWN_VIP_STREAMS[slot][serv]) || [];
    for (const item of known) {
      if (!item?.source || seenSources.has(item.source) || isBlockedStreamUrl(item.source)) continue;
      seenSources.add(item.source);
      resolvedList.push({ source: item.source, player: item.player || "clappr", serv, cached: true });
    }
  }

  const probed = await Promise.all(
    resolvedList.map(async (r) => {
      const p = await streamProbe(r.source, "wk", request);
      return { r, p };
    })
  );
  const candidates = probed
    .filter((x) => x.p.ok)
    .sort((a, b) => a.p.score - b.p.score)
    .map((x) => ({ ...x.r, score: x.p.score }));
  return { candidates, firstHtml };
}

async function resolveDlMirror(id, origin, secret, request) {
  const m3u8 = await resolveDlStream(id);
  if (!m3u8 || !isHlsUrl(m3u8)) return null;
  const probe = await streamProbe(m3u8, "dl", request);
  if (!probe.ok) return null;
  const sig = await signTarget(m3u8, secret);
  return { url: hlsProxyUrl(m3u8, origin, sig, "/dl/hls"), score: probe.score + 900, dlhdId: id };
}

// Resolve all configured dlhd mirrors for a channel (ordered). Each verified-live
// mirror joins the VIP pool. Signed for /dl/hls (dlhd CDN rejects wk Referer).
async function resolveDlChannelMirrors(channelId, origin, secret, request) {
  const ids = DLHD_CHANNEL_MIRROR_IDS[channelId];
  if (!ids || !ids.length) return [];
  const mirrors = await Promise.all(ids.map((id) => resolveDlMirror(id, origin, secret, request)));
  const out = [];
  const seen = new Set();
  const allIds = [...ids];
  for (const id of GLOBAL_DLHD_FALLBACK_IDS) {
    if (!allIds.includes(id)) allIds.push(id);
  }
  for (const id of allIds) {
    const m3u8 = await resolveDlStream(id);
    if (!m3u8 || !isHlsUrl(m3u8) || seen.has(m3u8)) continue;
    const probe = await streamProbe(m3u8, "dl", request);
    if (!probe.ok) continue;
    seen.add(m3u8);
    const sig = await signTarget(m3u8, secret);
    out.push({ url: hlsProxyUrl(m3u8, origin, sig, "/dl/hls"), score: probe.score, dlhdId: id });
  }
  return out;
}

// Resolve any configured extra same-channel mirrors (e.g. kooracitty), verified
// live + smoothness-scored, signed through /wk/hls. Returns [{url, score}].
async function resolveExtraChannelMirrors(channelId, origin, secret, request) {
  const entries = EXTRA_CHANNEL_STREAMS[channelId] || [];
  const out = [];
  for (const entry of entries) {
    if (!entry || !isHlsUrl(entry.url)) continue;
    const probe = await streamProbe(entry.url, entry.kind || "plain", request);
    if (!probe.ok) continue;
    const sig = await signTarget(entry.url, secret);
    out.push({ url: hlsProxyUrl(entry.url, origin, sig), score: probe.score });
  }
  return out;
}

async function fetchWeshanHtml(request, serv) {
  const upstream = new URL(WESHAN);
  upstream.searchParams.set("serv", String(serv));
  const res = await fetch(upstream.toString(), {
    headers: {
      "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml",
      Referer: WESHAN,
    },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return res.text();
}

function weshanServerOrder(requestedServ) {
  const order = [];
  const raw = requestedServ != null && requestedServ !== "" ? Number(requestedServ) : 0;
  if (Number.isFinite(raw) && raw >= 0 && raw <= 3) order.push(raw);
  for (let s = 0; s <= 3; s++) if (!order.includes(s)) order.push(s);
  return order;
}

function kooraNormTeam(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function kooraTeamAr(name) {
  const key = kooraNormTeam(name);
  return KOORA_TEAM_AR[key] || String(name || "");
}

function findKooraCardHref(html, home, away) {
  const homeAr = kooraTeamAr(home);
  const awayAr = kooraTeamAr(away);
  const chunks = String(html || "").split(/<div class=['"]match-container/);
  for (let i = 1; i < chunks.length; i++) {
    const block = chunks[i];
    const hasHome =
      block.includes(homeAr) ||
      block.toLowerCase().includes(String(home || "").toLowerCase());
    const hasAway =
      block.includes(awayAr) ||
      block.toLowerCase().includes(String(away || "").toLowerCase());
    if (!hasHome || !hasAway) continue;
    const m = block.match(/<a\b[^>]*\bhref=(["'])(https?:\/\/[^"']+)\1/i);
    if (m && !/\/matches-(today|yesterday|tomorrow)\/?$/i.test(m[2])) return m[2];
  }
  return null;
}

async function resolveKooraCardUrl(request, home, away) {
  const pages = [KOORA_CITY, `${KOORA_CITY}matches-today/`];
  for (const pageUrl of pages) {
    const page = await fetchAltStreamHtml(pageUrl, request, KOORA_CITY);
    if (!page) continue;
    const card = findKooraCardHref(page.html, home, away);
    if (card) return card;
  }
  return null;
}

function extractSirTvPageLinks(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/https?:\/\/[cs]\.sirtv\.space[^\s"'<>]*/gi)) {
    out.push(m[0].replace(/&amp;/g, "&"));
  }
  return [...new Set(out)].slice(0, 3);
}

const KOORA_IFRAME_RE =
  /albaplayer|fluxion|veloqia|yalashot|shootsync|nexalure|sirtv|hesgoal|streams\.center|ok\.ru/i;

async function resolveKooraCityHlsFromPage(startUrl, request) {
  let page = await fetchAltStreamHtml(startUrl, request, KOORA_CITY);
  if (!page) return null;
  let referer = page.url;
  for (let depth = 0; depth < 6; depth++) {
    for (const c of extractHlsCandidates(page.html)) {
      if (c.source && isHlsUrl(c.source)) return { source: c.source, referer, cardUrl: startUrl };
    }
    const iframes = extractAnyIframeSrc(page.html, page.url);
    const next = iframes.find((u) => KOORA_IFRAME_RE.test(u)) || iframes[0];
    if (!next) break;
    page = await fetchAltStreamHtml(next, request, referer);
    if (!page) break;
    referer = page.url;
  }
  return null;
}

async function resolveKooraCityHls(cardUrl, request) {
  const queue = [cardUrl];
  const boot = await fetchAltStreamHtml(cardUrl, request, KOORA_CITY);
  if (boot?.html) {
    for (const link of extractSirTvPageLinks(boot.html)) {
      if (!queue.includes(link)) queue.push(link);
    }
  }
  for (const url of queue.slice(0, 5)) {
    const resolved = await resolveKooraCityHlsFromPage(url, request);
    if (resolved) return resolved;
  }
  return null;
}

function kooraIframeWrapper(matchRoute, routes, cardsTried) {
  return (
    matchRoute?.kooraWrapper ||
    routes.slots?.kooraCity?.wrapperUrl ||
    matchRoute?.kooraCard ||
    (Array.isArray(cardsTried) ? cardsTried.find(Boolean) : cardsTried) ||
    routes.slots?.kooraCity?.defaultCard ||
    KOORA_YALASHOT_DEFAULT
  );
}

async function pickKooraCards(request, { home, away, cardOverride, routes, matchRoute }) {
  if (cardOverride) return [cardOverride];
  const cards = [];
  const add = (url) => {
    if (url && !cards.includes(url)) cards.push(url);
  };
  if (home && away) add(matchRoute?.kooraCard || (await resolveKooraCardUrl(request, home, away)));
  add(routes.slots?.kooraCity?.defaultCard || KOORA_YALASHOT_DEFAULT);
  return cards;
}

async function resolveKooraCityMirrorPool(request, env, origin, secret) {
  const incoming = new URL(request.url);
  const home = incoming.searchParams.get("home") || "";
  const away = incoming.searchParams.get("away") || "";
  const routes = await loadStreamRoutes(env, origin);
  const routeKey = matchRouteKey(home, away);
  const matchRoute = routes.byMatch?.[routeKey];
  const cards = await pickKooraCards(request, { home, away, cardOverride: "", routes, matchRoute });

  let resolved = null;
  for (const card of cards) {
    resolved = await resolveKooraCityHls(card, request);
    if (resolved) break;
  }
  if (!resolved || !resolved.source) return [];
  const probe = await streamProbe(resolved.source, "plain", request);
  if (!probe.ok) return [];
  const sig = await signTarget(resolved.source, secret);
  return [{ url: hlsProxyUrl(resolved.source, origin, sig), score: probe.score + 800 }];
}

async function proxyKooraCity(request, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const secret = env && env.STREAM_SIGNING_SECRET;
  const isHead = request.method === "HEAD";
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "X-KZ-Proxy": "kooracity",
  };
  if (isHead) return new Response(null, { status: 200, headers: htmlHeaders });

  const home = incoming.searchParams.get("home") || "";
  const away = incoming.searchParams.get("away") || "";
  const cardOverride = incoming.searchParams.get("card") || "";
  const routes = await loadStreamRoutes(env, origin);
  const routeKey = matchRouteKey(home, away);
  const matchRoute = routes.byMatch?.[routeKey];
  const cards = await pickKooraCards(request, { home, away, cardOverride, routes, matchRoute });

  // The kooora-city crawl (sirtv/shootsync CDNs) geo-blocks the CF edge with a
  // "Website Access Blocked" page, and the yalashot default card is dead too.
  // Serve the live dlhd 24/7 pool first so بديل كورة سيتي still plays; only fall
  // back to the raw iframe when even dlhd is empty.
  async function iframeFallback(reason) {
    const dlPool = await resolveDlhdFallbackPool(origin, secret, request);
    if (dlPool.length) {
      return new Response(cleanHlsPlayerHtml(dlPool.map((m) => m.url), "Koora City"), {
        status: 200,
        headers: {
          ...htmlHeaders,
          "X-KZ-Mirrors": String(dlPool.length),
          "X-KZ-Mode": `dlhd-fallback:${reason || "koora"}`,
        },
      });
    }
    const wrapperUrl = kooraIframeWrapper(matchRoute, routes, cards);
    if (!wrapperUrl) return null;
    return new Response(cleanAltEmbedWrapperHtml(wrapperUrl, "Koora City", reason || "koora-iframe"), {
      status: 200,
      headers: { ...htmlHeaders, "X-KZ-Mode": "iframe-heal" },
    });
  }

  try {
    let resolved = null;
    for (const card of cards) {
      resolved = await resolveKooraCityHls(card, request);
      if (resolved) break;
    }

    if (!resolved || !resolved.source) {
      const healed = await iframeFallback("no-hls");
      if (healed) return healed;
      return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });
    }

    const probe = await streamProbe(resolved.source, "plain", request);
    if (!probe.ok) {
      const healed = await iframeFallback("probe-fail");
      if (healed) return healed;
      return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });
    }

    const sig = await signTarget(resolved.source, secret);
    const proxied = hlsProxyUrl(resolved.source, origin, sig);
    return new Response(cleanHlsPlayerHtml([proxied], "Koora City"), {
      status: 200,
      headers: {
        ...htmlHeaders,
        "X-KZ-Card": resolved.cardUrl || "",
      },
    });
  } catch {
    const healed = await iframeFallback("error");
    if (healed) return healed;
    return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });
  }
}

async function fetchSirTvCh1Html(request, routes) {
  const player = routes?.slots?.sirTv?.player || SIRTV_CH1_PLAYER;
  const referer = routes?.slots?.sirTv?.referer || SIRTV_CH1_REFERER;
  try {
    const res = await fetchWithTimeout(player, {
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml",
        Referer: referer,
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (isDeadShellHtml(html)) return null;
    return html;
  } catch {
    return null;
  }
}

async function proxySirTv(request, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const secret = env && env.STREAM_SIGNING_SECRET;
  const isHead = request.method === "HEAD";
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "X-KZ-Proxy": "sirtv-ch1",
  };
  if (isHead) return new Response(null, { status: 200, headers: htmlHeaders });

  try {
    const routes = await loadStreamRoutes(env, origin);
    const html = await fetchSirTvCh1Html(request, routes);
    if (!html) return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });
    const candidates = extractHlsCandidates(html);
    const seenSources = new Set();
    const pool = [];
    for (const c of candidates) {
      if (!c.source || seenSources.has(c.source)) continue;
      const probe = await streamProbe(c.source, "plain", request);
      if (!probe.ok) continue;
      seenSources.add(c.source);
      const sig = await signTarget(c.source, secret);
      pool.push({ url: hlsProxyUrl(c.source, origin, sig), score: probe.score });
    }
    pool.sort((a, b) => a.score - b.score);
    const proxied = pool.map((m) => m.url);
    if (!proxied.length) return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });
    return new Response(cleanHlsPlayerHtml(proxied, "Sir TV"), { status: 200, headers: htmlHeaders });
  } catch {
    return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });
  }
}

function extractAnyIframeSrc(html, base) {
  const out = [];
  for (const m of String(html || "").matchAll(/<iframe\b[^>]*\bsrc=(["'])([^"']+)\1/gi)) {
    try {
      out.push(new URL(m[2], base).href);
    } catch {
      // Skip malformed iframe URLs.
    }
  }
  return out;
}

async function fetchAltStreamHtml(url, request, referer) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml",
        Referer: referer || url,
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return { url: res.url, html: await res.text() };
  } catch {
    return null;
  }
}

async function resolveNtvPlayablePage(request, routes) {
  const embedUrl = routes?.slots?.ntv?.embedUrl || NTV_EMBED;
  let page = await fetchAltStreamHtml(embedUrl, request, "https://ntv.cx/");
  if (!page || isDeadShellHtml(page.html)) return null;
  for (let depth = 0; depth < 5; depth++) {
    if (isDeadShellHtml(page.html)) break;
    const candidates = extractHlsCandidates(page.html);
    if (candidates.length) return { html: page.html, url: page.url, candidates };
    const iframes = extractAnyIframeSrc(page.html, page.url);
    const next =
      iframes.find((u) => !/hls2\.php\?stream=/i.test(u)) ||
      iframes.find((u) => /streams\.center|hesgoal|ch2\.php/i.test(u)) ||
      iframes[0];
    if (!next) break;
    page = await fetchAltStreamHtml(next, request, page.url);
    if (!page || isDeadShellHtml(page.html)) break;
  }
  return page && !isDeadShellHtml(page.html)
    ? { html: page.html, url: page.url, candidates: extractHlsCandidates(page.html) }
    : null;
}

function sanitizeAltEmbedHtml(html, baseUrl) {
  let out = String(html || "");
  out = out.replace(/<script\b[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/gi, (tag) =>
    (ALT_STREAM_AD_HOSTS.test(tag) ? "" : tag)
  );
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) =>
    (ALT_STREAM_AD_HOSTS.test(tag) ? "" : tag)
  );
  out = out.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  out = out.replace(/<meta[^>]+http-equiv=["']refresh["'][^>]*>/gi, "");
  try {
    const base = new URL(baseUrl);
    out = out.replace(/<head>/i, `<head><base href="${base.origin}${base.pathname}${base.search}">`);
  } catch {
    // Keep upstream HTML as-is when base URL is invalid.
  }
  return out;
}

function cleanAltEmbedWrapperHtml(embedUrl, title, healTag) {
  const safe = String(embedUrl || "").replace(/"/g, "&quot;");
  const label = String(title || "Stream").replace(/</g, "");
  const tag = String(healTag || "alt-heal").replace(/[^a-z0-9-]/gi, "");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${label}</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#f{width:100vw;height:100vh;border:0;display:block;background:#000}</style>
</head><body>
<iframe id="f" src="${safe}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" referrerpolicy="no-referrer"></iframe>
<script>
(function(){
  var f=document.getElementById('f'), lastAt=0, tag='${tag}';
  function heal(reason){
    if(!f||!f.src) return;
    var now=Date.now();
    if(now-lastAt<8000) return;
    lastAt=now;
    try{
      var u=new URL(f.src);
      u.searchParams.set('_heal', String(now));
      f.src=u.toString();
    }catch(e){}
    try{ window.parent.postMessage({type:'kz-alt-reload', reason:reason||tag}, '*'); }catch(e){}
  }
  if(f){ f.addEventListener('error', function(){ heal(tag + '-error'); }); }
  setInterval(function(){ heal(tag + '-periodic'); }, 50000);
})();
</script>
</body></html>`;
}

function cleanNtvEmbedWrapperHtml(embedUrl) {
  return cleanAltEmbedWrapperHtml(embedUrl, "NTV", "ntv-heal");
}

async function proxyNtv(request, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const secret = env && env.STREAM_SIGNING_SECRET;
  const isHead = request.method === "HEAD";
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "X-KZ-Proxy": "ntv-clean",
  };
  if (isHead) return new Response(null, { status: 200, headers: htmlHeaders });

  try {
    const routes = await loadStreamRoutes(env, origin);
    const resolved = await resolveNtvPlayablePage(request, routes);
    if (!resolved) return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });

    const pool = [];
    const seen = new Set();
    for (const c of resolved.candidates || []) {
      if (!c.source || seen.has(c.source)) continue;
      const probe = await streamProbe(c.source, "plain", request);
      if (!probe.ok) continue;
      seen.add(c.source);
      const sig = await signTarget(c.source, secret);
      pool.push({ url: hlsProxyUrl(c.source, origin, sig), score: probe.score });
    }
    pool.sort((a, b) => a.score - b.score);
    const proxied = pool.map((m) => m.url);
    if (proxied.length) {
      return new Response(cleanHlsPlayerHtml(proxied, "NTV"), { status: 200, headers: htmlHeaders });
    }

    const wrapperUrl = pickNtvWrapperUrl(resolved.url, routes);
    if (wrapperUrl) {
      return new Response(cleanNtvEmbedWrapperHtml(wrapperUrl), {
        status: 200,
        headers: { ...htmlHeaders, "X-KZ-Mode": "iframe-heal" },
      });
    }
    return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });
  } catch {
    return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });
  }
}

async function proxyWeshan(request, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const secret = env && env.STREAM_SIGNING_SECRET;
  const isHead = request.method === "HEAD";
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "X-KZ-Proxy": "weshan",
  };
  const requestedServ = incoming.searchParams.get("serv");

  if (isHead) {
    return new Response(null, { status: 200, headers: htmlHeaders });
  }

  try {
    const seenSources = new Set();
    const pool = [];
    for (const serv of weshanServerOrder(requestedServ)) {
      const html = await fetchWeshanHtml(request, serv);
      if (!html) continue;
      const resolved = await resolvePlayableSourceFromHtml(html, request, 0, new Set());
      if (!resolved || !isHlsUrl(resolved.source) || seenSources.has(resolved.source)) continue;
      const probe = await streamProbe(resolved.source, "plain", request);
      if (!probe.ok) continue;
      seenSources.add(resolved.source);
      const sig = await signTarget(resolved.source, secret);
      pool.push({ url: hlsProxyUrl(resolved.source, origin, sig), score: probe.score, serv });
    }
    pool.sort((a, b) => a.score - b.score);
    const proxied = [];
    for (const m of pool) if (!proxied.includes(m.url)) proxied.push(m.url);

    if (proxied.length) {
      return new Response(cleanHlsPlayerHtml(proxied, "Weshan بث"), {
        status: 200,
        headers: {
          ...htmlHeaders,
          "X-KZ-Serv": String((pool[0] && pool[0].serv) ?? ""),
          "X-KZ-Mirrors": String(proxied.length),
        },
      });
    }
    return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });
  } catch {
    return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });
  }
}

const AMINE = "https://yallashooot.tv/albaplayer/amine/";
const AMINE_RE = /^\/wk\/albaplayer\/amine\/?$/i;
const KORAPLUS_RE = /^\/wk\/albaplayer\/koraplus\/?$/i;
const KORAPLUS_EDGES = ["a4", "a11", "a12", "a13", "a14", "a15", "a16", "a17", "a18", "a19", "a20"];
const KORAPLUS_EDGE_DOMAIN = "kora-plus.app";
const DADDY_RE = /^\/wk\/albaplayer\/daddy\/?$/i;
const AEROZAST = "https://yallashooot.tv/albaplayer/aerozast/";
const AEROZAST_RE = /^\/wk\/albaplayer\/aerozast\/?$/i;
const YALASHOT_CARD = "https://tt.yalashot.online/2026/06/ch1.html?m=1";

async function fetchAerozastHtml(request, serv) {
  const upstream = new URL(AEROZAST);
  upstream.searchParams.set("serv", String(serv));
  try {
    const res = await fetchWithTimeout(upstream.toString(), {
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml",
        Referer: YALASHOT_CARD,
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

function aerozastServerOrder(requestedServ) {
  const order = [];
  const raw = requestedServ != null && requestedServ !== "" ? Number(requestedServ) : 1;
  if (Number.isFinite(raw) && raw >= 1 && raw <= 4) order.push(raw);
  for (let s = 1; s <= 4; s++) if (!order.includes(s)) order.push(s);
  return order;
}

// Live dlhd 24/7 feeds, resolved + verified + signed through /dl/hls. Used as
// the main-player fallback when the yalashot/aerozast chain yields no playable
// mirror (its CDN goes 403 "Website Access Blocked" from the CF edge). Ordered
// by smoothness; first entry wins. Isolated from the /wk/ path on purpose.
async function resolveDlhdFallbackPool(origin, secret, request) {
  const out = [];
  const seen = new Set();
  for (const id of GLOBAL_DLHD_FALLBACK_IDS) {
    const m3u8 = await resolveDlStream(id);
    if (!m3u8 || !isHlsUrl(m3u8) || seen.has(m3u8)) continue;
    const probe = await streamProbe(m3u8, "dl", request);
    if (!probe.ok) continue;
    seen.add(m3u8);
    const sig = await signTarget(m3u8, secret);
    out.push({ url: hlsProxyUrl(m3u8, origin, sig, "/dl/hls"), score: probe.score, dlhdId: id });
  }
  out.sort((a, b) => a.score - b.score);
  return out;
}

async function proxyAerozast(request, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const secret = env && env.STREAM_SIGNING_SECRET;
  const isHead = request.method === "HEAD";
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "X-KZ-Proxy": "aerozast",
  };
  const requestedServ = incoming.searchParams.get("serv");

  if (isHead) {
    return new Response(null, { status: 200, headers: htmlHeaders });
  }

  try {
    const seenSources = new Set();
    const pool = [];
    for (const serv of aerozastServerOrder(requestedServ)) {
      const html = await fetchAerozastHtml(request, serv);
      if (!html) continue;
      const resolved = await resolvePlayableSourceFromHtml(html, request, 0, new Set());
      if (!resolved || !isHlsUrl(resolved.source) || seenSources.has(resolved.source)) continue;
      seenSources.add(resolved.source);
      const probe = await streamProbe(resolved.source, "plain", request);
      const sig = await signTarget(resolved.source, secret);
      pool.push({
        url: hlsProxyUrl(resolved.source, origin, sig),
        score: probe.ok ? probe.score : 9500,
        serv,
        soft: !probe.ok,
      });
    }
    pool.sort((a, b) => a.score - b.score);
    const proxied = [];
    for (const m of pool) if (!proxied.includes(m.url)) proxied.push(m.url);

    if (proxied.length) {
      return new Response(cleanHlsPlayerHtml(proxied, "بث مباشر"), {
        status: 200,
        headers: {
          ...htmlHeaders,
          "X-KZ-Serv": String((pool[0] && pool[0].serv) ?? ""),
          "X-KZ-Mirrors": String(proxied.length),
        },
      });
    }

    // yalashot/aerozast chain dead (freshfin CDN geo/IP-blocks the CF edge).
    // Serve the live dlhd 24/7 pool so the main player still plays; self-heals
    // back to aerozast automatically once its CDN returns.
    const dlPool = await resolveDlhdFallbackPool(origin, secret, request);
    if (dlPool.length) {
      return new Response(cleanHlsPlayerHtml(dlPool.map((m) => m.url), "بث مباشر"), {
        status: 200,
        headers: {
          ...htmlHeaders,
          "X-KZ-Serv": "dlhd",
          "X-KZ-Mirrors": String(dlPool.length),
          "X-KZ-Mode": "dlhd-fallback",
        },
      });
    }

    return new Response(cleanAltEmbedWrapperHtml(AEROZAST + "?serv=1", "بث مباشر", "aerozast-fallback"), {
      status: 200,
      headers: { ...htmlHeaders, "X-KZ-Mode": "iframe-heal" },
    });
  } catch {
    return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });
  }
}

async function fetchAmineHtml(request, serv) {
  const upstream = new URL(AMINE);
  upstream.searchParams.set("serv", String(serv));
  try {
    const res = await fetchWithTimeout(upstream.toString(), {
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml",
        Referer: AMINE,
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

function amineServerOrder(requestedServ) {
  const order = [];
  const raw = requestedServ != null && requestedServ !== "" ? Number(requestedServ) : 0;
  if (Number.isFinite(raw) && raw >= 0 && raw <= 3) order.push(raw);
  for (let s = 0; s <= 3; s++) if (!order.includes(s)) order.push(s);
  return order;
}

// ── KoraPlus proxy — iframe to go4score's edge CDN Clappr player ─────────────
// CF Workers strip Sec-Fetch-* headers, so we can't proxy frame.php server-side
// (the edge gates on Sec-Fetch-Dest: iframe). Instead, serve a lightweight
// iframe wrapper pointing directly to the kora-plus.app edge CDN. The user's
// browser loads it with real headers, so the Clappr player works.
// Channel is passed as ?ch= (e.g. /wk/albaplayer/koraplus/?ch=bein-max-1).
function koraPlusFrameUrl(channel, token, kt, edge) {
  const e = edge || KORAPLUS_EDGES[Math.floor(Math.random() * KORAPLUS_EDGES.length)];
  const qs = new URLSearchParams({ ch: channel || "max1", p: "12" });
  if (token) qs.set("token", token);
  if (kt) qs.set("kt", String(kt));
  return `https://${e}.${KORAPLUS_EDGE_DOMAIN}/frame.php?${qs.toString()}`;
}

async function proxyKoraPlus(request, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const isHead = request.method === "HEAD";
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "X-KZ-Proxy": "koraplus",
  };

  if (isHead) return new Response(null, { status: 200, headers: htmlHeaders });

  // Map KZ channel IDs to koraplus channel slugs
  const KZ_TO_KP = {
    "bein-max-1": "max1",
    "bein-max-2": "max2",
    "bein-max-3": "max3",
    "bein-max-4": "max4",
    "bein-sports-1": "b1",
    "bein-sports-2": "b2",
  };
  const rawCh = incoming.searchParams.get("ch") || "bein-max-1";
  const channel = KZ_TO_KP[rawCh] || rawCh;

  const token = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : "kz-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  const kt = String(Math.floor(Date.now() / 1000));
  const edgeUrl = koraPlusFrameUrl(channel, token, kt);

  // Simple iframe wrapper — browser loads the edge CDN directly with real headers
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KoraZero</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#f{width:100vw;height:100vh;border:0;display:block}</style>
</head><body>
${/* eslint-disable-next-line no-script-url */ ""}
<iframe id="f" src="${edgeUrl.replace(/"/g, "&quot;")}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>
<script>
(function(){
  var f=document.getElementById('f'), lastAt=0;
  function heal(){
    var now=Date.now(); if(now-lastAt<30000) return; lastAt=now;
    try{ var u=new URL(f.src); u.searchParams.set('_heal',String(now)); f.src=u.toString(); }catch(e){}
    try{ window.parent.postMessage({type:'kz-alt-reload',reason:'koraplus-heal'},'*'); }catch(e){}
  }
  f.addEventListener('error',function(){ heal(); });
  setInterval(function(){ heal(); }, 90000);
})();
</script>
</body></html>`;

  return new Response(html, { status: 200, headers: htmlHeaders });
}

function daddyChannelId(rawCh) {
  const map = {
    // Use Daddy's documented Arabic Sports iframe pool for MAX fallbacks.
    // stream-597 (MAX AR) is often provider-blocked; stream-91 is the published example.
    "bein-max-1": 91,
    "bein-max-2": 92,
    "bein-max-3": 94,
    "bein-max-4": 95,
    "bein-sports-1": 91,
    "bein-sports-2": 92,
    "bein-sports-3": 93,
    "bein-sports-4": 94,
    "bein-sports-5": 95,
  };
  if (/^\d{1,6}$/.test(String(rawCh || ""))) return String(rawCh);
  return String(map[rawCh] || 91);
}

async function proxyDaddy(request, env) {
  const incoming = new URL(request.url);
  const isHead = request.method === "HEAD";
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "X-KZ-Proxy": "daddy-direct",
  };
  if (isHead) return new Response(null, { status: 200, headers: htmlHeaders });

  const rawCh = incoming.searchParams.get("ch") || "bein-max-1";
  const id = daddyChannelId(rawCh);
  const upstream = `${DLHD_BASE}/stream/stream-${id}.php`;
  const safe = upstream.replace(/"/g, "&quot;");
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KoraZero · DaddyLive</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#f{width:100vw;height:100vh;border:0;display:block;background:#000}</style>
</head><body>
<iframe id="f" src="${safe}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" referrerpolicy="no-referrer" loading="eager"></iframe>
<script>
(function(){
  var f=document.getElementById('f'), lastAt=0;
  function heal(reason){
    var now=Date.now(); if(now-lastAt<30000) return; lastAt=now;
    try{ var u=new URL(f.src); u.searchParams.set('_heal', String(now)); f.src=u.toString(); }catch(e){}
    try{ window.parent.postMessage({type:'kz-alt-reload', reason:reason||'daddy-heal'}, '*'); }catch(e){}
  }
  if(f) f.addEventListener('error', function(){ heal('daddy-error'); });
  setInterval(function(){ heal('daddy-periodic'); }, 90000);
})();
</script>
</body></html>`;
  return new Response(html, { status: 200, headers: htmlHeaders });
}



async function proxyAmine(request, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const secret = env && env.STREAM_SIGNING_SECRET;
  const isHead = request.method === "HEAD";
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "X-KZ-Proxy": "amine",
  };
  const requestedServ = incoming.searchParams.get("serv");

  if (isHead) {
    return new Response(null, { status: 200, headers: htmlHeaders });
  }

  try {
    const seenSources = new Set();
    const pool = [];
    for (const serv of amineServerOrder(requestedServ)) {
      const html = await fetchAmineHtml(request, serv);
      if (!html) continue;
      const resolved = await resolvePlayableSourceFromHtml(html, request, 0, new Set());
      if (!resolved || !isHlsUrl(resolved.source) || seenSources.has(resolved.source)) continue;
      const probe = await streamProbe(resolved.source, "plain", request);
      if (!probe.ok) continue;
      seenSources.add(resolved.source);
      const sig = await signTarget(resolved.source, secret);
      pool.push({ url: hlsProxyUrl(resolved.source, origin, sig), score: probe.score, serv });
    }
    pool.sort((a, b) => a.score - b.score);
    const proxied = [];
    for (const m of pool) if (!proxied.includes(m.url)) proxied.push(m.url);

    if (proxied.length) {
      return new Response(cleanHlsPlayerHtml(proxied, "بث مباشر"), {
        status: 200,
        headers: {
          ...htmlHeaders,
          "X-KZ-Serv": String((pool[0] && pool[0].serv) ?? ""),
          "X-KZ-Mirrors": String(proxied.length),
        },
      });
    }
    return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });
  } catch {
    return new Response("Upstream unavailable", { status: 502, headers: htmlHeaders });
  }
}

async function emergencyDlPlayable(channelId, origin, secret) {
  const ids = [
    ...(DLHD_CHANNEL_MIRROR_IDS[channelId] || []),
    ...GLOBAL_DLHD_FALLBACK_IDS,
  ];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const m3u8 = await resolveDlStream(id);
    if (!m3u8 || !isHlsUrl(m3u8)) continue;
    const sig = await signTarget(m3u8, secret);
    return hlsProxyUrl(m3u8, origin, sig, "/dl/hls");
  }
  return null;
}

async function proxyVip(request, slot, env) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const channelId = incoming.searchParams.get("ch") || "";
  const secret = env && env.STREAM_SIGNING_SECRET;
  const isHead = request.method === "HEAD";
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "X-KZ-Proxy": "worldkoora-vip",
  };

  if (isHead) {
    const requestedServ = incoming.searchParams.get("serv") || 1;
    const page = await fetchVipServerHtml(request, slot, requestedServ);
    const status = page.html ? 200 : (DLHD_CHANNEL_IDS[channelId] ? 200 : page.status);
    return new Response(null, { status, headers: htmlHeaders });
  }

  try {
    const { candidates, firstHtml } = await resolveVipSlotStream(request, slot);
    const twitchChannel = await resolveTwitchChannel(request, slot, firstHtml, env, channelId);

    const pool = [];
    for (const c of candidates || []) {
      const sig = await signTarget(c.source, secret);
      pool.push({ url: hlsProxyUrl(c.source, origin, sig), score: c.score });
    }
    for (const dlMirror of await resolveDlChannelMirrors(channelId, origin, secret, request)) pool.push(dlMirror);
    for (const extra of await resolveExtraChannelMirrors(channelId, origin, secret, request)) pool.push(extra);

    pool.sort((a, b) => a.score - b.score);
    const proxied = [];
    for (const m of pool) if (!proxied.includes(m.url)) proxied.push(m.url);

    let usedKooraFallback = false;
    if (!proxied.length) {
      for (const m of await resolveKooraCityMirrorPool(request, env, origin, secret)) {
        if (!proxied.includes(m.url)) proxied.push(m.url);
        usedKooraFallback = true;
      }
    }

    if (twitchChannel && proxied.length) {
      return dualPlayerResponse(proxied, twitchChannel, origin, htmlHeaders, {
        "X-KZ-Mirrors": String(proxied.length),
        "X-KZ-Serv": String((candidates && candidates[0] && candidates[0].serv) || ""),
      });
    }
    if (twitchChannel) {
      return twitchPlayerResponse(twitchChannel, origin, htmlHeaders);
    }
    if (proxied.length) {
      const headers = {
        ...htmlHeaders,
        "X-KZ-Serv": String((candidates && candidates[0] && candidates[0].serv) || ""),
        "X-KZ-Mirrors": String(proxied.length),
      };
      if (usedKooraFallback) headers["X-KZ-Mode"] = "koora-fallback";
      return new Response(cleanHlsPlayerHtml(proxied, `${slot} بث`), {
        status: 200,
        headers,
      });
    }

    const dlSrc = await emergencyDlPlayable(channelId, origin, secret);
    if (dlSrc) {
      return new Response(cleanHlsPlayerHtml(dlSrc, `${slot} بث`), {
        status: 200,
        headers: { ...htmlHeaders, "X-KZ-Mode": "dl-emergency" },
      });
    }

    const home = incoming.searchParams.get("home") || "";
    const away = incoming.searchParams.get("away") || "";
    const routes = await loadStreamRoutes(env, origin);
    const routeKey = matchRouteKey(home, away);
    const matchRoute = routes.byMatch?.[routeKey];
    const cards = await pickKooraCards(request, { home, away, cardOverride: "", routes, matchRoute });
    const kooraWrap = kooraIframeWrapper(matchRoute, routes, cards);
    if (kooraWrap) {
      return new Response(cleanAltEmbedWrapperHtml(kooraWrap, "Koora City", "vip-koora-fallback"), {
        status: 200,
        headers: { ...htmlHeaders, "X-KZ-Mode": "koora-iframe-fallback" },
      });
    }

    if (firstHtml) {
      return new Response(await cleanWorldkooraHtml(firstHtml, slot, origin, secret, request), {
        status: 200,
        headers: htmlHeaders,
      });
    }
    return new Response("Upstream unavailable", { status: 502 });
  } catch {
    try {
      const dlSrc = await emergencyDlPlayable(channelId, origin, secret);
      if (dlSrc) {
        return new Response(cleanHlsPlayerHtml(dlSrc, `${slot} بث`), {
          status: 200,
          headers: { ...htmlHeaders, "X-KZ-Mode": "dl-emergency" },
        });
      }
    } catch {
      // Fall through to 502.
    }
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
async function resolveDlPremiumTvEmbed(id) {
  const headers = { "User-Agent": "Mozilla/5.0", Referer: `${DLHD_BASE}/` };
  try {
    const sTxt = await (await fetchWithTimeout(`${DLHD_BASE}/stream/stream-${id}.php`, { headers })).text();
    const m = sTxt.match(/<iframe[^>]+src="([^"]+\/premiumtv\/[^"]+)"/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function resolveDlStream(id) {
  const headers = { "User-Agent": "Mozilla/5.0", Referer: `${DLHD_BASE}/` };
  try {
    const sTxt = await (await fetchWithTimeout(`${DLHD_BASE}/stream/stream-${id}.php`, { headers })).text();
    const embed = sTxt.match(/<iframe[^>]+src="([^"]+\/premiumtv\/[^"]+)"/i);
    if (!embed) return null;
    const eTxt = await (await fetchWithTimeout(embed[1], { headers })).text();
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

async function proxyLabDlEmbed(request, id, env) {
  const origin = new URL(request.url).origin;
  const secret = env && env.STREAM_SIGNING_SECRET;
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-KZ-Proxy": "lab-dlhd-embed",
  };
  const m3u8 = await resolveDlStream(id);
  if (!m3u8) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh;text-align:center"><div>البث غير متاح حالياً — أعد المحاولة<br><small>lab channel ${id}</small></div></body>`,
      { status: 200, headers: htmlHeaders }
    );
  }
  // Must go through the same signed same-origin proxy as the working /dl/{id}
  // route: cleanHlsPlayerHtml's <video> is crossorigin="anonymous", so the
  // browser enforces CORS on every request. dlhd's CDN doesn't send the
  // Access-Control-Allow-Origin headers a cross-origin video element needs,
  // so loading its m3u8 URL directly silently fails in every real browser —
  // even though a server-side fetch (no CORS involved) returns 200 fine.
  const sig = await signTarget(m3u8, secret);
  const src = hlsProxyUrl(m3u8, origin, sig, "/dl/hls");
  return new Response(dlPlayerHtml(src, id), { status: 200, headers: htmlHeaders });
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
        "Cache-Control": "public, max-age=3",
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
      "Cache-Control": "public, max-age=60",
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
// Ordered referers for shootny playerv5 — siir-tv.live is the current Sir TV front-end.
const SIR_REFERRERS = [
  "https://www.siir-tv.live/",
  "https://sir-tv-new.me/",
  "https://siiiiiiir.tv/",
  SIR_REFERER,
];
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

// Fetch shootny player page; rotate referers (siir-tv.live first).
async function fetchSirPlayerHtml() {
  for (const referer of SIR_REFERRERS) {
    try {
      const res = await fetch(`${SIR_PLAYER}?match=${SIR_PROBE_MATCH}&key=${SIR_KEY}`, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html", Referer: referer },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (sirDecodeConfig(html)) return html;
    } catch { /* try next referer */ }
  }
  return null;
}

// Resolve a channel slug to a freshly-signed foozlive master playlist URL.
async function resolveSirMaster(slug) {
  const html = await fetchSirPlayerHtml();
  if (!html) return null;
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
      var h=new Hls({enableWorker:true,maxBufferLength:14,maxMaxBufferLength:28,backBufferLength:30,liveSyncDurationCount:2,liveMaxLatencyDurationCount:6,maxLiveSyncPlaybackRate:1.35,manifestLoadingMaxRetry:6,fragLoadingMaxRetry:6,highBufferWatchdogPeriod:2,capLevelToPlayerSize:true});
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

function pollJsonHeaders(extra) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    ...(extra || {}),
  };
}

function pollCountsKey(id) {
  return new Request(`${POLL_STORE}counts/${id}`);
}

function pollVoterKey(id, voter) {
  return new Request(`${POLL_STORE}voter/${id}/${voter}`);
}

function pollPayload(counts, teams) {
  const total = teams.reduce((sum, key) => sum + (counts[key] || 0), 0);
  const percentages = {};
  teams.forEach((key) => {
    percentages[key] = total ? Math.round(((counts[key] || 0) / total) * 100) : 0;
  });
  return { ...counts, total, percentages };
}

async function readPollCounts(pollId, teams) {
  const hit = await caches.default.match(pollCountsKey(pollId));
  const raw = hit ? await hit.json() : {};
  const counts = {};
  teams.forEach((key) => { counts[key] = raw[key] || 0; });
  return counts;
}

async function writePollCounts(pollId, counts) {
  await caches.default.put(
    pollCountsKey(pollId),
    new Response(JSON.stringify(counts), {
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=31536000" },
    })
  );
}

async function pollHasVoted(pollId, voterId) {
  if (!voterId) return false;
  return !!(await caches.default.match(pollVoterKey(pollId, voterId)));
}

async function markPollVoted(pollId, voterId) {
  await caches.default.put(
    pollVoterKey(pollId, voterId),
    new Response("1", { headers: { "Cache-Control": "max-age=31536000" } })
  );
}

async function handlePoll(request, pollId, env) {
  const origin = new URL(request.url).origin;
  const teams = await pollTeamsFor(pollId, env, origin);
  if (!teams) {
    return new Response(JSON.stringify({ error: "unknown_poll" }), { status: 404, headers: pollJsonHeaders() });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: pollJsonHeaders({
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }),
    });
  }

  if (request.method === "GET") {
    const counts = await readPollCounts(pollId, teams);
    return new Response(JSON.stringify(pollPayload(counts, teams)), { status: 200, headers: pollJsonHeaders() });
  }

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "bad_json" }), { status: 400, headers: pollJsonHeaders() });
    }
    const team = String(body.team || "");
    const voterId = String(body.voterId || "").slice(0, 80);
    if (!teams.includes(team)) {
      return new Response(JSON.stringify({ error: "bad_team" }), { status: 400, headers: pollJsonHeaders() });
    }
    if (!voterId) {
      return new Response(JSON.stringify({ error: "bad_voter" }), { status: 400, headers: pollJsonHeaders() });
    }

    if (await pollHasVoted(pollId, voterId)) {
      const counts = await readPollCounts(pollId, teams);
      return new Response(
        JSON.stringify({ ...pollPayload(counts, teams), already: true, voted: team }),
        { status: 200, headers: pollJsonHeaders() }
      );
    }

    await markPollVoted(pollId, voterId);
    const counts = await readPollCounts(pollId, teams);
    counts[team] = (counts[team] || 0) + 1;
    await writePollCounts(pollId, counts);
    return new Response(
      JSON.stringify({ ...pollPayload(counts, teams), voted: team }),
      { status: 200, headers: pollJsonHeaders() }
    );
  }

  return new Response("Method not allowed", { status: 405, headers: pollJsonHeaders() });
}

/* ----------------------------------------------- ملخص replays (vortex + YouTube fallback)
 * Primary: nvtboo.vortexvisionworks.com embeds (btolat/kawkabnews source).
 * Fallback: YouTube Data API when YOUTUBE_API_KEY is set.
 * GET /api/highlight?home=&away=&kickoff= */
const HIGHLIGHT_API_RE = /^\/api\/highlight\/?$/i;
const REPLAY_EMBED_RE = /^\/replay\/embed\/([A-Za-z0-9]+)\/?$/i;
const REPLAY_ASSET_RE = /^\/replay\/asset\/?$/i;
const VORTEX_HOST = "nvtboo.vortexvisionworks.com";
const VORTEX_EMBED_BASE = `https://${VORTEX_HOST}/embed`;
const VORTEX_BASE = `https://${VORTEX_HOST}`;
const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const HIGHLIGHT_ARABIC_RE = /[؀-ۿ]/;
const YOUTUBE_ID_RE = /^[\w-]{11}$/;
const REPLAY_ADBLOCK_FILTERS = `
||doubleclick.net^
||googlesyndication.com^
||googletagmanager.com^
||google-analytics.com^
||adservice.google.com^
||imasdk.googleapis.com^
||cloudflareinsights.com^
`;

let _replayAdblockEngine = null;

function replayAdblockEngine() {
  if (!_replayAdblockEngine) _replayAdblockEngine = FiltersEngine.parse(REPLAY_ADBLOCK_FILTERS);
  return _replayAdblockEngine;
}

function replayResourceType(url, fallback = "other") {
  let path = "";
  try { path = new URL(url, VORTEX_BASE).pathname.toLowerCase(); } catch { /* noop */ }
  if (/\.(?:js|mjs)$/.test(path)) return "script";
  if (/\.css$/.test(path)) return "stylesheet";
  if (/\.(?:png|jpe?g|webp|gif|svg)$/.test(path)) return "image";
  if (/\.(?:m3u8|mp4|ts|m4s)$/.test(path)) return "media";
  return fallback;
}

function replayAdblockMatches(rawUrl, type = "other") {
  try {
    const target = new URL(rawUrl, VORTEX_BASE);
    const { match } = replayAdblockEngine().match(AdblockRequest.fromRawDetails({
      url: target.href,
      type,
      sourceUrl: VORTEX_EMBED_BASE,
    }));
    return !!match;
  } catch {
    return false;
  }
}

let _teamArCache = null;
let _knownVortexCache = null;

const VORTEX_TEAM_AR_ALIASES = {
  Paraguay: ["باراجواي"],
};

async function loadTeamAr(env, origin) {
  if (_teamArCache) return _teamArCache;
  try {
    const res = await env.ASSETS.fetch(`${origin}/assets/data/team-names-ar.json`);
    _teamArCache = res.ok ? await res.json() : {};
  } catch {
    _teamArCache = {};
  }
  return _teamArCache;
}

async function loadKnownVortex(env, origin) {
  if (_knownVortexCache) return _knownVortexCache;
  try {
    const res = await env.ASSETS.fetch(`${origin}/assets/data/vortex-highlights.json`);
    _knownVortexCache = res.ok ? await res.json() : {};
  } catch {
    _knownVortexCache = {};
  }
  return _knownVortexCache;
}

function teamArabic(teamAr, name) {
  return (teamAr && teamAr[name]) || name || "";
}

function vortexTeamNames(teamAr, name) {
  const primary = teamArabic(teamAr, name);
  const aliases = VORTEX_TEAM_AR_ALIASES[name] || [];
  return [primary, name, ...aliases].filter(Boolean);
}

function highlightPairKey(home, away) {
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  return [norm(home), norm(away)].sort().join("~");
}

function vortexSearchQueries(home, away, teamAr) {
  const queries = new Set();
  const homeNames = vortexTeamNames(teamAr, home).slice(0, 2);
  const awayNames = vortexTeamNames(teamAr, away).slice(0, 2);
  for (const h of homeNames) {
    for (const a of awayNames) {
      queries.add(`site:${VORTEX_HOST} ${h} ${a}`);
    }
  }
  return [...queries];
}

function extractVortexEmbedIds(html) {
  const ids = new Set();
  const patterns = [
    /nvtboo\.vortexvisionworks\.com\/embed\/([A-Za-z0-9]+)/gi,
    /vortexvisionworks\.com(?:%2F|\/)embed(?:%2F|\/)([A-Za-z0-9]+)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html || ""))) ids.add(m[1]);
  }
  return [...ids];
}

function parseOgMeta(html, prop) {
  const m = (html || "").match(new RegExp(`<meta property="${prop}" content="([^"]+)"`, "i"));
  return m ? m[1] : "";
}

const FULL_MATCH_TITLE_RE = /مباراة\s+كاملة|كامل(?:ة)?\s*(?:للمباراة|المباراة)?|full\s*match|match\s*replay|replay\s*full|إعادة\s*كاملة|90\s*دقيقة|بث\s*كامل/i;

function classifyHighlightTitle(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (!t || FULL_MATCH_TITLE_RE.test(t)) return null;
  if (/^(?:اهداف|أهداف)\s+مباراة/i.test(t)) return "goals";
  if (/^ملخص\s+مباراة/i.test(t)) return "full";
  if (/ملخص/i.test(t) && /مباراة|كأس العالم|world cup/i.test(t)) return "full";
  if (/(?:اهداف|أهداف)/i.test(t) && /مباراة|كأس العالم|world cup/i.test(t)) return "goals";
  return null;
}

function vortexTitleMatches(title, home, away, teamAr) {
  if (!classifyHighlightTitle(title)) return false;
  const t = String(title).replace(/\s+/g, " ").trim();
  const homeHit = vortexTeamNames(teamAr, home).some((n) => t.includes(n));
  const awayHit = vortexTeamNames(teamAr, away).some((n) => t.includes(n));
  return homeHit && awayHit;
}

async function searchDdgVortexIds(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MorshLive/1.0)", Accept: "text/html,*/*" },
    redirect: "follow",
  });
  if (!res.ok) return [];
  return extractVortexEmbedIds(await res.text());
}

async function fetchVortexEmbedMeta(id) {
  const res = await fetch(`${VORTEX_EMBED_BASE}/${id}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MorshLive/1.0)", Accept: "text/html,*/*" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const html = await res.text();
  const title = parseOgMeta(html, "og:title");
  if (!title) return null;
  const kind = classifyHighlightTitle(title);
  if (!kind) return null;
  return {
    videoUrl: `${VORTEX_EMBED_BASE}/${id}`,
    title,
    thumbnail: parseOgMeta(html, "og:image") || "",
    source: "vortex",
    embedId: id,
    kind,
  };
}

async function searchKnownVortexHighlight(home, away, known) {
  const hit = known && known[highlightPairKey(home, away)];
  if (!hit) return null;
  const ids = typeof hit === "string" ? { full: hit } : { goals: hit.goals, full: hit.full };
  if (ids.full) {
    const full = await fetchVortexEmbedMeta(ids.full);
    if (full) return full;
  }
  if (ids.goals) return fetchVortexEmbedMeta(ids.goals);
  return null;
}

async function searchVortexHighlight(home, away, teamAr, known) {
  const pinned = await searchKnownVortexHighlight(home, away, known);
  if (pinned) return pinned;

  const seen = new Set();
  for (const q of vortexSearchQueries(home, away, teamAr)) {
    const ids = await searchDdgVortexIds(q);
    for (const id of ids.slice(0, 10)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const meta = await fetchVortexEmbedMeta(id);
      if (meta && vortexTitleMatches(meta.title, home, away, teamAr)) return meta;
    }
  }
  return null;
}

function highlightQueries(home, away, teamAr) {
  const homeAr = teamArabic(teamAr, home);
  const awayAr = teamArabic(teamAr, away);
  return [
    `ملخص واهداف مباراة ${homeAr} و ${awayAr} تعليق عربي`,
    `ملخص مباراة ${homeAr} و ${awayAr} كأس العالم 2026`,
    `اهداف مباراة ${homeAr} ضد ${awayAr} تعليق عربي`,
  ];
}

function pickArabicHighlight(items) {
  for (const item of items || []) {
    const videoId = item.id && item.id.videoId;
    if (!videoId || !YOUTUBE_ID_RE.test(videoId)) continue;
    const snippet = item.snippet || {};
    const text = `${snippet.title || ""} ${snippet.description || ""}`;
    if (!HIGHLIGHT_ARABIC_RE.test(text)) continue;
    return {
      videoUrl: `https://www.youtube.com/embed/${videoId}`,
      title: snippet.title || "",
      channelTitle: snippet.channelTitle || "",
      thumbnail: (snippet.thumbnails && snippet.thumbnails.medium && snippet.thumbnails.medium.url) || "",
      source: "youtube",
    };
  }
  return null;
}

async function searchYouTubeHighlight(apiKey, queries, kickoffUtc) {
  for (const q of queries) {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      maxResults: "5",
      order: "relevance",
      relevanceLanguage: "ar",
      videoEmbeddable: "true",
      safeSearch: "strict",
      q,
      key: apiKey,
    });
    const kickoffMs = Date.parse(kickoffUtc || "");
    if (!isNaN(kickoffMs)) params.set("publishedAfter", new Date(kickoffMs).toISOString());
    const res = await fetch(`${YOUTUBE_SEARCH_URL}?${params.toString()}`, {
      headers: { "User-Agent": "morsh-live/1.0" },
    });
    if (!res.ok) continue;
    const json = await res.json();
    if (json.error) continue;
    const found = pickArabicHighlight(json.items);
    if (found) return found;
  }
  return null;
}

async function lookupStaticHighlights(env, origin, home, away) {
  const key = highlightPairKey(home, away);
  const today = await loadTodayMatches(env, origin);
  let m = today.find((x) => highlightPairKey(x.home, x.away) === key);
  if (!m?.highlight && !m?.highlights && !(m?.clips?.length)) {
    const archive = await loadTournamentArchiveMatches(env, origin);
    m = archive.find((x) => highlightPairKey(x.home, x.away) === key) || m;
  }
  if (!m) return null;
  const primary = m.highlight || m.highlights?.full || m.highlights?.goals || null;
  if (!primary?.videoUrl && !m.highlights && !(m.clips?.length)) return null;
  return {
    highlight: primary,
    highlights: m.highlights || null,
    clips: m.clips || [],
    videoUrl: primary?.videoUrl,
    title: primary?.title,
    thumbnail: primary?.thumbnail,
    source: primary?.source || "archive",
  };
}

async function proxyHighlightApi(request, env) {
  const url = new URL(request.url);
  const home = (url.searchParams.get("home") || "").trim();
  const away = (url.searchParams.get("away") || "").trim();
  const kickoff = url.searchParams.get("kickoff") || "";
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
    "X-KZ-Proxy": "highlight-api",
  };
  if (!home || !away) {
    return new Response(JSON.stringify({ error: "home and away required" }), { status: 400, headers });
  }
  try {
    const staticHit = await lookupStaticHighlights(env, url.origin, home, away);
    if (staticHit) {
      return new Response(JSON.stringify(staticHit), {
        status: 200,
        headers: { ...headers, "X-KZ-Highlight-Source": "archive" },
      });
    }

    const teamAr = await loadTeamAr(env, url.origin);
    const knownVortex = await loadKnownVortex(env, url.origin);

    const vortex = await searchVortexHighlight(home, away, teamAr, knownVortex);
    if (vortex) {
      return new Response(JSON.stringify(vortex), {
        status: 200,
        headers: { ...headers, "X-KZ-Highlight-Source": "vortex" },
      });
    }

    const apiKey = env && env.YOUTUBE_API_KEY;
    if (apiKey) {
      const yt = await searchYouTubeHighlight(apiKey, highlightQueries(home, away, teamAr), kickoff);
      if (yt) {
        return new Response(JSON.stringify(yt), {
          status: 200,
          headers: { ...headers, "X-KZ-Highlight-Source": "youtube" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "internal error" }), { status: 502, headers });
  }
}

function absoluteReplayUrl(raw, base = VORTEX_BASE) {
  try { return new URL(raw, base).href; } catch { return ""; }
}

function replayAssetProxyUrl(raw, type, origin, base = VORTEX_BASE) {
  const abs = absoluteReplayUrl(raw, base);
  if (!abs) return raw;
  return `${origin}/replay/asset?type=${encodeURIComponent(type || replayResourceType(abs))}&u=${encodeURIComponent(abs)}`;
}

function replayManifestIsM3u8(target, contentType) {
  return /\.m3u8(?:\?|#|$)/i.test(String(target || ""))
    || /mpegurl|m3u8/i.test(String(contentType || ""));
}

function rewriteReplayM3u8(body, manifestUrl, origin) {
  return rewriteReplayM3u8Lines(body, manifestUrl, origin, (abs) =>
    replayAssetProxyUrl(abs, replayResourceType(abs, "media"), origin)
  );
}

function sanitizeReplayEmbedHtml(html, id, origin) {
  const base = `${VORTEX_EMBED_BASE}/${id}`;
  let out = String(html || "");
  out = out
    .replace(/<script[^>]+src=["'][^"']*(?:googletagmanager|cloudflareinsights|google-analytics|doubleclick|googlesyndication|imasdk)[^"']*["'][^>]*>\s*<\/script>/gi, "")
    .replace(/ads\s*:\s*true/gi, "ads:false")
    .replace(/adSchedule\s*:\s*\{[\s\S]*?\}\s*,\s*adBlockerDetectedPreventPlayback/gi, "adSchedule:{},adBlockerDetectedPreventPlayback")
    .replace(/adBlockerDetectedPreventPlayback\s*:\s*true/gi, "adBlockerDetectedPreventPlayback:false")
    .replace(/adBlockerDetection\s*:\s*true/gi, "adBlockerDetection:false")
    .replace(/adForceImaInWebView\s*:\s*true/gi, "adForceImaInWebView:false")
    .replace(/https:\/\/pubads\.g\.doubleclick\.net\/gampad\/ads\?[^"'\\\]\s<)]+/gi, "");

  out = out.replace(/(<script[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, (all, pre, src, post) => {
    const abs = absoluteReplayUrl(src, base);
    if (!abs || replayAdblockMatches(abs, "script")) return "";
    return `${pre}${replayAssetProxyUrl(abs, "script", origin, base)}${post}`;
  });
  out = out.replace(/(<link[^>]+href=["'])([^"']+)(["'][^>]*>)/gi, (all, pre, href, post) => {
    const abs = absoluteReplayUrl(href, base);
    if (!abs || replayAdblockMatches(abs, "stylesheet")) return "";
    return `${pre}${replayAssetProxyUrl(abs, replayResourceType(abs, "stylesheet"), origin, base)}${post}`;
  });
  out = out.replace(/(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, (all, pre, src, post) =>
    `${pre}${replayAssetProxyUrl(src, "image", origin, base)}${post}`
  );
  out = out.replace(/(["'])\/\/(hls[^"']+flashframenetwork\.com[^"']+)(["'])/gi, (all, q1, rest, q2) =>
    `${q1}${replayAssetProxyUrl(`https://${rest}`, replayResourceType(`https://${rest}`, "media"), origin, base)}${q2}`
  );
  out = out.replace(/(["'])https:\/\/(hls[^"']+flashframenetwork\.com[^"']+)(["'])/gi, (all, q1, rest, q2) =>
    `${q1}${replayAssetProxyUrl(`https://${rest}`, replayResourceType(`https://${rest}`, "media"), origin, base)}${q2}`
  );
  const gtagStub = `<script>window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};</script>`;
  out = out.replace(/<\/head>/i, `${gtagStub}<base href="${VORTEX_BASE}/" /></head>`);
  return out;
}

async function proxyReplayEmbed(request, id) {
  const origin = new URL(request.url).origin;
  const upstream = await fetch(`${VORTEX_EMBED_BASE}/${id}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; KoraZero/1.0)", Accept: "text/html,*/*" },
    redirect: "follow",
  });
  if (!upstream.ok) return new Response("Replay unavailable", { status: upstream.status });
  const html = sanitizeReplayEmbedHtml(await upstream.text(), id, origin);
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=900",
      "X-KZ-Proxy": "replay-embed",
      "Content-Security-Policy": "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' https://nvtboo.vortexvisionworks.com https://ajax.googleapis.com; style-src 'self' 'unsafe-inline' https://nvtboo.vortexvisionworks.com; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' https:; frame-src 'none';",
    },
  });
}

async function proxyReplayAsset(request) {
  const url = new URL(request.url);
  const target = absoluteReplayUrl(url.searchParams.get("u") || "");
  const type = url.searchParams.get("type") || replayResourceType(target);
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    "X-KZ-Proxy": "replay-asset",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!target || replayAdblockMatches(target, type)) {
    return new Response("", { status: 204, headers });
  }
  const upstreamHeaders = {
    "User-Agent": "Mozilla/5.0 (compatible; KoraZero/1.0)",
    Accept: request.headers.get("Accept") || "*/*",
    Referer: VORTEX_EMBED_BASE + "/",
  };
  const range = request.headers.get("Range");
  if (range) upstreamHeaders.Range = range;
  const upstream = await fetch(target, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: upstreamHeaders,
    redirect: "follow",
    cf: { cacheEverything: true, cacheTtl: 86400 },
  });
  const out = new Headers(headers);
  for (const h of ["Content-Type", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  const origin = url.origin;
  const upstreamType = upstream.headers.get("Content-Type") || "";
  if (request.method !== "HEAD" && replayManifestIsM3u8(target, upstreamType) && upstream.ok) {
    const text = await upstream.text();
    const rewritten = rewriteReplayM3u8(text, target, origin);
    out.set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
    return new Response(rewritten, { status: upstream.status, headers: out });
  }
  const len = upstream.headers.get("Content-Length");
  if (len) out.set("Content-Length", len);
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
}

/* ----------------------------------------------- viral X memes
 * Home: @TrollFootball + @memesvsfootball — last 50 each, top 75% by likes
 * Match tab: any caption mentioning teams or players from curated accounts
 * GET /api/match-memes?home=&away=&kickoff=
 * GET /api/recent-memes */
const MEMES_API_RE = /^\/api\/match-memes\/?$/i;
const RECENT_MEMES_API_RE = /^\/api\/recent-memes\/?$/i;
const X_MEDIA_API_RE = /^\/api\/x-media\/?$/i;
const EDGE_API_RE = /^\/api\/edge\/?$/i;
const STREAM_DIAGNOSE_RE = /^\/api\/stream-diagnose\/?$/i;
const XTREAM_API_RE = /^\/api\/xtream\/(status|categories|live)\/?$/i;
const TWITCH_API_RE = /^\/api\/twitch\/?$/i;
const STREAMS_LAB_RE = /^\/api\/streams-lab\/?$/i;
const SIIR_MATCHES_RE = /^\/api\/siir-matches\/?$/i;
const SIIR_MATCH_EMBED_RE = /^\/siir\/m\/(\d+)\/?$/i;
const SIIR_BASE = "https://www.siir-tv.live";
const SIIR_FETCH_UA = "Mozilla/5.0 (compatible; KoraZero/1.0)";
const RECENT_MEMES_MS = 24 * 60 * 60 * 1000;
const RECENT_MATCH_MEME_CONTEXT_MS = 72 * 60 * 60 * 1000;
const RECENT_MEMES_LIMIT = 48;
const RECENT_MEMES_SCAN_CACHE_MS = 10 * 60 * 1000;
const TWITTER_API_BASE = "https://api.twitter.com/2";
const MEME_MATCH_MS = 105 * 60 * 1000;
const MEME_LOOKBACK_BEFORE_KICKOFF_MS = 15 * 60 * 1000;


/* ----------------------------------------------- authorized Xtream importer
 * Reads private portal credentials from Cloudflare env/secret XTREAM_PORTALS_JSON.
 * Never returns usernames/passwords to the browser. Intended for user-owned,
 * authorized portals exported from PlayTorrio/IPTV generator.
 *
 * Secret format:
 *   {"portals":[{"url":"http://host:port","username":"...","password":"...","label":"optional"}]}
 */
function xtreamJson(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      ...extra,
    },
  });
}

function xtreamMask(value) {
  const s = String(value || "");
  if (s.length <= 4) return "***";
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
}

function xtreamSafeUrl(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.pathname = u.pathname.replace(/\/+$/, "");
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function loadXtreamPortals(env) {
  const raw = env && (env.XTREAM_PORTALS_JSON || env.IPTV_PORTALS_JSON);
  if (!raw) return { portals: [], error: "XTREAM_PORTALS_JSON secret is not configured" };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.portals) ? parsed.portals : []);
    const portals = [];
    list.forEach((item, idx) => {
      const nested = item && item.portal ? item.portal : item;
      const url = xtreamSafeUrl(nested.url || nested.portalUrl || nested.host);
      const username = nested.username || nested.user;
      const password = nested.password || nested.pass;
      if (!url || !username || !password) return;
      portals.push({
        id: `p${idx + 1}`,
        label: String(nested.label || nested.name || `Portal ${idx + 1}`),
        url,
        username: String(username),
        password: String(password),
        expiry: item.expiry || nested.expiry || null,
        maxConnections: item.maxConnections || nested.maxConnections || null,
        activeConnections: item.activeConnections || nested.activeConnections || null,
      });
    });
    return { portals };
  } catch (err) {
    return { portals: [], error: `Invalid XTREAM_PORTALS_JSON: ${err.message || err}` };
  }
}

function sanitizeXtreamPortal(p) {
  return {
    id: p.id,
    label: p.label,
    url: p.url,
    usernameMasked: xtreamMask(p.username),
    passwordMasked: xtreamMask(p.password),
    expiry: p.expiry,
    maxConnections: p.maxConnections,
    activeConnections: p.activeConnections,
  };
}

function xtreamApiUrl(p, action) {
  const u = new URL(`${p.url}/player_api.php`);
  u.searchParams.set("username", p.username);
  u.searchParams.set("password", p.password);
  if (action) u.searchParams.set("action", action);
  return u.toString();
}

async function fetchXtreamJson(p, action, timeoutMs = 14000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(xtreamApiUrl(p, action), {
      headers: {
        "User-Agent": "Mozilla/5.0 (KoraZero Xtream Importer)",
        "Accept": "application/json,text/plain,*/*",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response (${text.slice(0, 80).replace(/\s+/g, " ")})`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeXtreamAccount(info) {
  const userInfo = info && info.user_info ? info.user_info : {};
  const serverInfo = info && info.server_info ? info.server_info : {};
  return {
    auth: userInfo.auth,
    status: userInfo.status,
    expDate: userInfo.exp_date || null,
    maxConnections: userInfo.max_connections || null,
    activeConnections: userInfo.active_cons || null,
    allowedOutputFormats: userInfo.allowed_output_formats || [],
    serverProtocol: serverInfo.server_protocol || null,
    serverPort: serverInfo.port || null,
    timezone: serverInfo.timezone || null,
  };
}

function sanitizeXtreamCategory(row, portal) {
  return {
    portalId: portal.id,
    portalLabel: portal.label,
    categoryId: String(row.category_id || ""),
    name: String(row.category_name || row.name || "Uncategorized"),
    parentId: row.parent_id || null,
  };
}

function sanitizeXtreamLive(row, portal, categoryMap) {
  const categoryId = String(row.category_id || "");
  return {
    portalId: portal.id,
    portalLabel: portal.label,
    streamId: row.stream_id,
    name: row.name || "Untitled channel",
    categoryId,
    categoryName: categoryMap && categoryMap.get(categoryId) ? categoryMap.get(categoryId) : null,
    icon: row.stream_icon || null,
    epgChannelId: row.epg_channel_id || null,
    added: row.added || null,
    num: row.num || null,
    tvArchive: row.tv_archive || 0,
  };
}

async function proxyXtreamApi(request, env, action) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  const incoming = new URL(request.url);
  const { portals, error } = loadXtreamPortals(env);
  if (error) return xtreamJson({ ok: false, error, portals: [] }, 503);
  const selected = incoming.searchParams.get("portal");
  const usable = selected ? portals.filter((p) => p.id === selected || p.label === selected) : portals;
  if (!usable.length) return xtreamJson({ ok: false, error: "No matching Xtream portal configured", portals: portals.map(sanitizeXtreamPortal) }, 404);

  if (action === "status") {
    const results = await Promise.all(usable.map(async (p) => {
      const safe = sanitizeXtreamPortal(p);
      try {
        const info = await fetchXtreamJson(p, null, 10000);
        return { ...safe, ok: true, account: sanitizeXtreamAccount(info) };
      } catch (err) {
        return { ...safe, ok: false, error: err.name === "AbortError" ? "timeout" : String(err.message || err) };
      }
    }));
    return xtreamJson({ ok: true, count: results.length, portals: results });
  }

  if (action === "categories") {
    const blocks = await Promise.all(usable.map(async (p) => {
      const safe = sanitizeXtreamPortal(p);
      try {
        const rows = await fetchXtreamJson(p, "get_live_categories", 14000);
        const categories = Array.isArray(rows) ? rows.map((r) => sanitizeXtreamCategory(r, p)) : [];
        return { portal: safe, ok: true, count: categories.length, categories };
      } catch (err) {
        return { portal: safe, ok: false, error: err.name === "AbortError" ? "timeout" : String(err.message || err), categories: [] };
      }
    }));
    return xtreamJson({ ok: true, count: blocks.reduce((n, b) => n + b.categories.length, 0), portals: blocks });
  }

  if (action === "live") {
    const q = String(incoming.searchParams.get("q") || "").trim().toLowerCase();
    const category = String(incoming.searchParams.get("category") || "").trim();
    const limit = Math.max(1, Math.min(5000, Number(incoming.searchParams.get("limit") || 1000)));
    const blocks = await Promise.all(usable.map(async (p) => {
      const safe = sanitizeXtreamPortal(p);
      try {
        const [catRows, streamRows] = await Promise.all([
          fetchXtreamJson(p, "get_live_categories", 14000).catch(() => []),
          fetchXtreamJson(p, "get_live_streams", 20000),
        ]);
        const categoryMap = new Map((Array.isArray(catRows) ? catRows : []).map((r) => [String(r.category_id || ""), String(r.category_name || r.name || "Uncategorized")]));
        let streams = Array.isArray(streamRows) ? streamRows.map((r) => sanitizeXtreamLive(r, p, categoryMap)) : [];
        if (category) streams = streams.filter((s) => s.categoryId === category || (s.categoryName || "").toLowerCase() === category.toLowerCase());
        if (q) streams = streams.filter((s) => String(s.name || "").toLowerCase().includes(q));
        streams = streams.slice(0, limit);
        return { portal: safe, ok: true, count: streams.length, streams };
      } catch (err) {
        return { portal: safe, ok: false, error: err.name === "AbortError" ? "timeout" : String(err.message || err), streams: [] };
      }
    }));
    return xtreamJson({ ok: true, count: blocks.reduce((n, b) => n + b.streams.length, 0), portals: blocks });
  }

  return xtreamJson({ ok: false, error: "Unknown Xtream API action" }, 404);
}

function memePlayerTerms(match) {
  const names = [];
  const push = (n) => {
    const s = String(n || "").trim();
    if (s.length > 2 && !names.includes(s)) names.push(s);
  };
  for (const side of ["home", "away"]) {
    const lineup = match && match.lineups && match.lineups[side];
    if (!lineup) continue;
    for (const band of ["starters", "subs", "bench"]) {
      for (const p of lineup[band] || []) push(p.name);
    }
  }
  return names;
}

const MEME_MOMENT_TERMS = [
  "referee", "var", "penalty", "red card", "save", "keeper", "goalkeeper",
  "highlights", "miss", "chance", "ملخص", "هدف", "تصدي", "حارس", "حكم", "طرد", "جزاء", "فرصة", "عارضة",
];

function memeNormText(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function memeTeamHit(text, name) {
  const t = memeNormText(text);
  const n = memeNormText(name);
  return n.length > 2 && t.includes(n) ? 1 : 0;
}

function memePlayerHitScore(text, match) {
  const t = memeNormText(text);
  if (!t) return 0;
  let best = 0;
  for (const p of memePlayerTerms(match)) {
    const pn = memeNormText(p);
    if (pn.length > 3 && t.includes(pn)) best = Math.max(best, 1);
    for (const w of pn.split(/\s+/).filter((x) => x.length >= 4)) {
      if (t.includes(w)) best = Math.max(best, 0.8);
    }
  }
  return best;
}

function memeMomentHit(text) {
  const t = memeNormText(text);
  return MEME_MOMENT_TERMS.some((term) => t.includes(memeNormText(term)));
}

function memeCaptionScoreDetailed(text, home, away, match) {
  const homeHit = memeTeamHit(text, home);
  const awayHit = memeTeamHit(text, away);
  const player = memePlayerHitScore(text, match);
  const moment = memeMomentHit(text) ? 0.35 : 0;
  const teams = homeHit + awayHit;
  return { total: teams + player + moment, teams, homeHit, awayHit, player, moment };
}

function memeCaptionHits(text, home, away, match) {
  const s = memeCaptionScoreDetailed(text, home, away, match);
  if (s.homeHit && s.awayHit) return true;
  if (s.homeHit || s.awayHit) return true;
  if (s.player >= 0.8) return true;
  if (s.moment && (s.homeHit || s.awayHit || s.player >= 0.8)) return true;
  return false;
}

/** Match tab: any team or player mention in caption (no moment gate). */
function memeCaptionRelates(text, home, away, match) {
  const s = memeCaptionScoreDetailed(text, home, away, match);
  return !!(s.homeHit || s.awayHit || s.player > 0);
}

function memeCaptionScore(text, home, away, match) {
  return memeCaptionScoreDetailed(text, home, away, match).total;
}

function memeUniversalHits(text, memeConfig) {
  const t = String(text || "").toLowerCase();
  const terms = Array.isArray(memeConfig?.universalTerms) ? memeConfig.universalTerms : [];
  return terms.some((term) => t.includes(String(term).toLowerCase()));
}

function memePostWindow(kickoffUtc) {
  const kickoff = Date.parse(kickoffUtc || "");
  if (isNaN(kickoff)) return null;
  const now = Date.now();
  const contextEnd = kickoff + RECENT_MATCH_MEME_CONTEXT_MS;
  return {
    start: new Date(kickoff - MEME_LOOKBACK_BEFORE_KICKOFF_MS).toISOString(),
    end: new Date(Math.min(Math.max(now, kickoff + MEME_MATCH_MS), contextEnd)).toISOString(),
  };
}

const MEME_PREVIEW_MS = 14 * 24 * 60 * 60 * 1000;

function memePreviewWindow(kickoffUtc) {
  const kickoff = Date.parse(kickoffUtc || "");
  if (isNaN(kickoff) || kickoff <= Date.now()) return null;
  return {
    start: new Date(Math.max(Date.now() - 86400000, kickoff - MEME_PREVIEW_MS)).toISOString(),
    end: new Date(kickoff + 15 * 60 * 1000).toISOString(),
  };
}

function inferMemeStatusFromKickoff(kickoffUtc, explicitStatus) {
  if (explicitStatus === "live" || explicitStatus === "ended" || explicitStatus === "upcoming") {
    return explicitStatus;
  }
  const kickoff = Date.parse(kickoffUtc || "");
  if (isNaN(kickoff)) return explicitStatus || "ended";
  const now = Date.now();
  if (kickoff > now + 5 * 60 * 1000) return "upcoming";
  if (kickoff + MEME_MATCH_MS < now) return "ended";
  return "live";
}

function memeWindowForStatus(kickoffUtc, status) {
  return status === "upcoming" ? memePreviewWindow(kickoffUtc) : memePostWindow(kickoffUtc);
}

function resolveMemeTarget(text, matches, universalTerms) {
  const universal = memeUniversalHits(text, { universalTerms });
  const ranked = (matches || [])
    .filter((m) => m?.home && m?.away)
    .map((m) => {
      const s = memeCaptionScoreDetailed(text, m.home, m.away, m);
      const status = inferMemeStatusFromKickoff(m.kickoffUtc, m.status);
      return { key: highlightPairKeyMemes(m.home, m.away), score: s.total, ...s, match: m, status };
    })
    .filter((r) => r.total >= 0.8)
    .sort((a, b) => b.score - a.score || (Date.parse(b.match.kickoffUtc || "") - Date.parse(a.match.kickoffUtc || "")));

  const top = ranked[0];
  const second = ranked[1];
  if (top && memeMatchUnambiguous(top, second)) {
    const m = top.match;
    const status = top.status;
    return {
      matchKey: top.key,
      scope: status === "upcoming" ? "upcoming" : "match",
      home: m.home,
      away: m.away,
      score: status === "ended" || status === "live" ? m.score || null : null,
      kickoffUtc: m.kickoffUtc || null,
      status,
    };
  }

  if (universal) {
    return {
      matchKey: "worldcup",
      scope: "worldcup",
      home: null,
      away: null,
      score: null,
      kickoffUtc: null,
      status: null,
    };
  }

  return null;
}

function memeMatchUnambiguous(top, second) {
  if (!top) return false;
  if (top.homeHit && top.awayHit) return true;
  if (top.player >= 0.8 && (!second || top.player > second.player + 0.1)) return true;
  if (top.teams >= 1 && (!second || top.total >= second.total + 0.45)) return true;
  if (top.moment && top.teams >= 1 && (!second || top.total >= second.total + 0.35)) return true;
  return false;
}

function bestMemeMatchKey(text, matches) {
  return resolveMemeTarget(text, matches, [])?.matchKey || null;
}

function orderMemesByPostedAt(memes) {
  return [...(memes || [])]
    .map((m, i) => ({ ...m, _order: i }))
    .sort((a, b) => {
      const ta = Date.parse(a.postedAt || "") || 0;
      const tb = Date.parse(b.postedAt || "") || 0;
      if (tb !== ta) return tb - ta;
      return (a._order || 0) - (b._order || 0);
    })
    .map(({ _order, ...m }) => m);
}

function orderMemesOldestFirst(memes) {
  return [...(memes || [])]
    .map((m, i) => ({ ...m, _order: i }))
    .sort((a, b) => {
      const ta = Date.parse(a.postedAt || "") || 0;
      const tb = Date.parse(b.postedAt || "") || 0;
      if (ta !== tb) return ta - tb;
      return (a._order || 0) - (b._order || 0);
    })
    .map(({ _order, ...m }) => m);
}

function memeEngagement(m) {
  const x = m || {};
  return (x.like_count || 0) + (x.retweet_count || 0) * 2 + (x.quote_count || 0) * 2;
}

function memeInWindow(createdAt, window) {
  const t = Date.parse(createdAt || "");
  return t >= Date.parse(window.start) && t <= Date.parse(window.end);
}

// Wrangler secrets often arrive with a trailing newline; the worker sends the
// token raw in the Authorization header, so an untrimmed value yields a 401 and
// a silently empty meme pool. Normalize (and drop an accidental "Bearer " prefix).
function readBearer(env) {
  const raw = env && env.TWITTER_BEARER_TOKEN;
  if (!raw) return null;
  return String(raw).trim().replace(/^Bearer\s+/i, "") || null;
}

async function fetchAccountTweets(bearer, userId, startTime, endTime) {
  const params = new URLSearchParams({
    max_results: "30",
    "tweet.fields": "created_at,public_metrics,attachments,author_id",
    expansions: "attachments.media_keys,author_id",
    "media.fields": "preview_image_url,url,type,variants,width,height",
    "user.fields": "profile_image_url,username",
    start_time: startTime,
    end_time: endTime,
    exclude: "retweets,replies",
  });
  const res = await fetch(`${TWITTER_API_BASE}/users/${userId}/tweets?${params}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!res.ok) return { tweets: [], includes: {} };
  const json = await res.json();
  return { tweets: json.data || [], includes: json.includes || {} };
}

async function fetchAccountTweetsSince(bearer, userId, startTime, endTime, maxPages = 4) {
  const tweets = [];
  const includes = { media: [], users: [] };
  let nextToken = null;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      max_results: "100",
      "tweet.fields": "created_at,public_metrics,attachments,author_id",
      expansions: "attachments.media_keys,author_id",
      "media.fields": "preview_image_url,url,type,variants,width,height",
      "user.fields": "profile_image_url,username",
      start_time: startTime,
      end_time: endTime,
      exclude: "retweets,replies",
    });
    if (nextToken) params.set("pagination_token", nextToken);
    const res = await fetch(`${TWITTER_API_BASE}/users/${userId}/tweets?${params}`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (!res.ok) break;
    const json = await res.json();
    tweets.push(...(json.data || []));
    if (json.includes?.media) includes.media.push(...json.includes.media);
    if (json.includes?.users) includes.users.push(...json.includes.users);
    nextToken = json.meta?.next_token;
    if (!nextToken || !(json.data || []).length) break;
  }
  return { tweets, includes };
}

const SYNDICATION_BASE = "https://syndication.twitter.com/srv/timeline-profile/screen-name";

async function fetchSyndicationTimeline(screenName, limit = 80) {
  const url = `${SYNDICATION_BASE}/${encodeURIComponent(screenName)}?dnt=false&lang=en&limit=${limit}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; KoraZero/1.0)" } });
  if (!res.ok) return [];
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  const entries = data?.props?.pageProps?.timeline?.entries || [];
  return entries
    .filter((e) => e.type === "tweet")
    .map((e) => {
      const c = e.content || {};
      const tweet = c.tweet || c;
      const id = (e.entry_id || "").replace(/^tweet-/, "") || tweet.id_str || tweet.id;
      const text = tweet.text || tweet.full_text || "";
      if (!id) return null;
      const metrics = tweet.public_metrics || {};
      const syndMedia = tweet.mediaDetails || tweet.entities?.media || [];
      return {
        id: String(id),
        text,
        created_at: tweet.created_at || tweet.date || null,
        author_id: tweet.user_id_str || tweet.user?.id_str || null,
        syndication_media: syndMedia,
        user: tweet.user || null,
        public_metrics: {
          like_count: metrics.like_count || tweet.favorite_count || 0,
          retweet_count: metrics.retweet_count || 0,
          quote_count: metrics.quote_count || 0,
        },
      };
    })
    .filter(Boolean);
}

function pickVideoVariant(variants) {
  const list = Array.isArray(variants) ? variants : [];
  const mp4 = list
    .filter((v) => v.content_type === "video/mp4" && v.url)
    .sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));
  return mp4[0] || null;
}

function extractTweetMedia(tweet, includes) {
  const keys = tweet?.attachments?.media_keys || [];
  const bag = includes?.media || [];
  return keys.map((key) => {
    const m = bag.find((x) => x.media_key === key);
    if (!m) return null;
    const video = m.type === "video" || m.type === "animated_gif" ? pickVideoVariant(m.variants) : null;
    const previewUrl = m.preview_image_url || m.url || video?.url || "";
    const url = m.type === "photo" ? (m.url || previewUrl) : (video?.url || previewUrl);
    if (!previewUrl && !url) return null;
    return { type: m.type || "photo", previewUrl, url };
  }).filter(Boolean);
}

function mediaFromSyndication(items) {
  return (items || []).map((m) => {
    const previewUrl = m.media_url_https || m.media_url || m.preview_image_url || "";
    const type = m.type === "video" ? "video" : m.type === "animated_gif" ? "animated_gif" : "photo";
    let url = previewUrl;
    if ((type === "video" || type === "animated_gif") && m.video_info?.variants) {
      const mp4 = m.video_info.variants
        .filter((v) => v.content_type === "video/mp4" && v.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      url = mp4[0]?.url || previewUrl;
    }
    if (!previewUrl && !url) return null;
    return { type, previewUrl: previewUrl || url, url: url || previewUrl };
  }).filter(Boolean);
}

const SYNDICATION_TWEET_BASE = "https://cdn.syndication.twimg.com/tweet-result";

async function fetchSyndicationTweet(tweetId) {
  if (!tweetId) return null;
  const params = new URLSearchParams({ id: String(tweetId), lang: "en", token: "0" });
  try {
    const res = await fetch(`${SYNDICATION_TWEET_BASE}?${params}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KoraZero/1.0)" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function memeFromSyndicationTweet(meme, synd) {
  if (!synd) return meme;
  const media = mediaFromSyndication(synd.mediaDetails || synd.entities?.media || []);
  const user = synd.user || {};
  const avatarUrl = user.profile_image_url_https || user.profile_image_url || meme.avatarUrl || null;
  return {
    ...meme,
    avatarUrl: avatarUrl || meme.avatarUrl,
    media: media.length ? media : (meme.media || []),
  };
}

function allowedXMediaUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "pbs.twimg.com" || host === "video.twimg.com") return url;
  } catch { /* invalid */ }
  return null;
}

async function proxyXMedia(request) {
  const reqUrl = new URL(request.url);
  const target = allowedXMediaUrl(reqUrl.searchParams.get("u") || "");
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    "X-KZ-Proxy": "x-media",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!target) {
    return new Response("bad media url", { status: 400, headers });
  }
  const upstreamHeaders = {
    "User-Agent": "Mozilla/5.0 (compatible; KoraZero/1.0)",
    Accept: request.headers.get("Accept") || "*/*",
  };
  const range = request.headers.get("Range");
  if (range) upstreamHeaders.Range = range;
  const upstream = await fetch(target.href, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: upstreamHeaders,
    cf: { cacheEverything: true, cacheTtl: 86400 },
  });
  const out = new Headers(headers);
  for (const h of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}

function mergeMemeLists(base, extra) {
  const byId = new Map();
  for (const meme of [...(base || []), ...(extra || [])]) {
    const id = String(meme?.tweetId || meme?.url || "");
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev || (meme.engagement || 0) > (prev.engagement || 0)) byId.set(id, meme);
  }
  return [...byId.values()].sort((a, b) => (b.engagement || 0) - (a.engagement || 0));
}

function pickTopMediaMemes(entries, limit) {
  return filterMemesWithMedia(entries)
    .sort((a, b) => (b.engagement || 0) - (a.engagement || 0))
    .slice(0, limit);
}

function memeToEntry(tweet, author, includes) {
  const engagement = memeEngagement(tweet.public_metrics);
  const users = includes?.users || [];
  const user = users.find((u) => u.id === tweet.author_id) || tweet.user || null;
  const avatarUrl = user?.profile_image_url || user?.profile_image_url_https || null;
  let media = extractTweetMedia(tweet, includes);
  if (!media.length && tweet.syndication_media) {
    media = mediaFromSyndication(tweet.syndication_media);
  }
  return {
    type: "tweet",
    url: `https://x.com/${author}/status/${tweet.id}`,
    text: tweet.text || "",
    author,
    tweetId: String(tweet.id),
    likes: tweet.public_metrics?.like_count || 0,
    retweets: tweet.public_metrics?.retweet_count || 0,
    engagement: Math.round(engagement),
    postedAt: tweet.created_at || null,
    avatarUrl,
    media,
  };
}

async function fetchTweetsByIds(bearer, ids) {
  const out = new Map();
  if (!bearer || !ids.length) return out;
  const chunk = ids.slice(0, 100);
  const params = new URLSearchParams({
    ids: chunk.join(","),
    "tweet.fields": "attachments,created_at,public_metrics,author_id",
    expansions: "attachments.media_keys,author_id",
    "media.fields": "preview_image_url,url,type,variants,width,height",
    "user.fields": "profile_image_url,username",
  });
  try {
    const res = await fetch(`${TWITTER_API_BASE}/tweets?${params}`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (!res.ok) return out;
    const json = await res.json();
    for (const tweet of json.data || []) {
      out.set(String(tweet.id), { tweet, includes: json.includes || {} });
    }
  } catch { /* optional enrich */ }
  return out;
}

async function enrichMemesMedia(memes, bearer) {
  if (!memes?.length) return memes;
  const need = memes.filter((m) => m.tweetId && !(m.media && m.media.length));
  if (!need.length) return memes;

  let out = memes;
  if (bearer) {
    const hits = await fetchTweetsByIds(bearer, need.map((m) => m.tweetId));
    out = memes.map((m) => {
      const hit = hits.get(String(m.tweetId));
      if (!hit) return m;
      const fresh = memeToEntry({ ...hit.tweet, text: hit.tweet.text || m.text }, m.author, hit.includes);
      return {
        ...m,
        text: fresh.text || m.text,
        likes: fresh.likes ?? m.likes,
        retweets: fresh.retweets ?? m.retweets,
        engagement: fresh.engagement ?? m.engagement,
        avatarUrl: fresh.avatarUrl || m.avatarUrl,
        media: fresh.media?.length ? fresh.media : (m.media || []),
      };
    });
  }

  const stillNeed = out.filter((m) => m.tweetId && !(m.media && m.media.length));
  if (!stillNeed.length) return out;

  const syndHits = await Promise.all(
    stillNeed.map(async (m) => ({ id: String(m.tweetId), synd: await fetchSyndicationTweet(m.tweetId) }))
  );
  const syndMap = new Map(syndHits.filter((h) => h.synd).map((h) => [h.id, h.synd]));
  if (!syndMap.size) return out;

  return out.map((m) => {
    const synd = syndMap.get(String(m.tweetId));
    return synd ? memeFromSyndicationTweet(m, synd) : m;
  });
}

async function searchCuratedMemesSyndication(home, away, kickoffUtc, match, memeConfig, timelineCache, seenIds) {
  const status = inferMemeStatusFromKickoff(kickoffUtc, match?.status);
  const window = memeWindowForStatus(kickoffUtc, status);
  if (!window) return [];
  const out = [];
  const config = memeConfig || { accounts: [], topPerAccount: 3 };
  for (const acct of config.accounts || []) {
    let tweets;
    try {
      if (timelineCache && timelineCache.has(acct.username)) {
        tweets = timelineCache.get(acct.username);
      } else {
        tweets = await fetchSyndicationTimeline(acct.username, 100);
        if (timelineCache) timelineCache.set(acct.username, tweets);
      }
    } catch {
      continue;
    }
    const hits = tweets
      .filter((t) => !seenIds || !seenIds.has(String(t.id)))
      .filter((t) => memeInWindow(t.created_at, window) && memeCaptionHits(t.text, home, away, match))
      .map((t) => memeToEntry(t, acct.username, {}));
    out.push(...pickTopMediaMemes(hits, config.topPerAccount || 3));
  }
  return out;
}

async function searchResolvedTimelineMemes(matches, memeConfig, timelineCache, sinceMs, seenIds) {
  const out = [];
  const config = memeConfig || { accounts: [], universalTerms: [] };
  const allMatches = matches || [];
  for (const acct of config.accounts || []) {
    let tweets;
    try {
      if (timelineCache && timelineCache.has(acct.username)) {
        tweets = timelineCache.get(acct.username);
      } else {
        tweets = await fetchSyndicationTimeline(acct.username, 100);
        if (timelineCache) timelineCache.set(acct.username, tweets);
      }
    } catch {
      continue;
    }
    for (const t of tweets) {
      if (seenIds && seenIds.has(String(t.id))) continue;
      if (!tweetPostedRecently(t.created_at, sinceMs)) continue;
      const target = resolveMemeTarget(t.text, allMatches, config.universalTerms);
      if (!target) continue;
      if (target.scope !== "worldcup") {
        const w = memeWindowForStatus(target.kickoffUtc, target.status);
        if (w && !memeInWindow(t.created_at, w)) continue;
      }
      out.push({
        entry: memeToEntry(t, acct.username, {}),
        target,
      });
    }
  }
  return out;
}

async function searchUniversalWorldCupMemesSyndication(memeConfig, timelineCache, sinceMs, seenIds) {
  const out = [];
  const config = memeConfig || { accounts: [], topPerAccount: 3, universalTerms: [] };
  for (const acct of config.accounts || []) {
    let tweets;
    try {
      if (timelineCache && timelineCache.has(acct.username)) {
        tweets = timelineCache.get(acct.username);
      } else {
        tweets = await fetchSyndicationTimeline(acct.username, 100);
        if (timelineCache) timelineCache.set(acct.username, tweets);
      }
    } catch {
      continue;
    }
    const hits = tweets
      .filter((t) => !seenIds || !seenIds.has(String(t.id)))
      .filter((t) => tweetPostedRecently(t.created_at, sinceMs))
      .filter((t) => memeUniversalHits(t.text, config))
      .map((t) => memeToEntry(t, acct.username, {}));
    out.push(...pickTopMediaMemes(hits, config.topPerAccount || 3));
  }
  return out;
}

async function searchCuratedMemes(bearer, home, away, kickoffUtc, match, memeConfig) {
  const status = inferMemeStatusFromKickoff(kickoffUtc, match?.status);
  const window = memeWindowForStatus(kickoffUtc, status);
  if (!window) return [];
  const out = [];
  const config = memeConfig || { accounts: [], topPerAccount: 3 };
  for (const acct of config.accounts || []) {
    if (!acct.id) continue;
    let tweets;
    let includes = {};
    try {
      const pack = await fetchAccountTweets(bearer, acct.id, window.start, window.end);
      tweets = pack.tweets;
      includes = pack.includes;
    } catch {
      continue;
    }
    const hits = tweets
      .filter((t) => memeInWindow(t.created_at, window) && memeCaptionHits(t.text, home, away, match))
      .map((t) => memeToEntry(t, acct.username, includes));
    out.push(...pickTopMediaMemes(hits, config.topPerAccount || 3));
  }
  return out;
}

let _memesIdxCache = null;
let _pinnedMemesCache = null;
let _memeSourcesCache = null;
let _recentMemesRuntimeCache = {
  at: 0,
  dayKey: null,
  memes: [],
  pending: [],
  seenIds: new Set(),
};

async function loadMemeSources(env, origin) {
  if (_memeSourcesCache) return _memeSourcesCache;
  try {
    const res = await env.ASSETS.fetch(`${origin}/assets/data/meme-sources.json`);
    const json = res.ok ? await res.json() : {};
    _memeSourcesCache = {
      accounts: Array.isArray(json.accounts) ? json.accounts.filter((a) => a?.key && a?.username) : [],
      topPerAccount: Number(json.topPerAccount) || 3,
      homeAccounts: Array.isArray(json.homeAccounts) ? json.homeAccounts.filter(Boolean) : ["TrollFootball", "memesvsfootball"],
      homeSinceUtc: json.homeSinceUtc || WC_HOME_SINCE_UTC,
      homeSyndicationLimit: Number(json.homeSyndicationLimit) || 100,
      homeTargetPerDay: Number(json.homeTargetPerDay) || 4,
      homeMinKeepFraction: Number(json.homeMinKeepFraction) || 0.7,
      homeMaxKeepFraction: Number(json.homeMaxKeepFraction) || 0.9,
      homeDayTzOffsetHours: Number(json.homeDayTzOffsetHours) || 3,
      homeDisplayDays: Number(json.homeDisplayDays) || 3,
      homeRecentDays: Number(json.homeRecentDays) || 2,
      homeRecentTargetPerDay: Number(json.homeRecentTargetPerDay) || Number(json.homeTargetPerDay) || 4,
      homeRecentMinKeepFraction: Number(json.homeRecentMinKeepFraction) || 0.5,
      homeRecentMaxKeepFraction: Number(json.homeRecentMaxKeepFraction) || 0.85,
      homeTodayRampHours: Number(json.homeTodayRampHours) || 18,
      homeTodayMinLikes: Number(json.homeTodayMinLikes) || 0,
      homeTodayMinAgeFactor: Number(json.homeTodayMinAgeFactor) || 0.05,
      matchFetchLimit: Number(json.matchFetchLimit) || 50,
      universalTerms: Array.isArray(json.universalTerms) ? json.universalTerms.filter(Boolean) : [],
    };
  } catch {
    _memeSourcesCache = {
      accounts: [],
      topPerAccount: 3,
      homeAccounts: ["TrollFootball", "memesvsfootball"],
      homeSinceUtc: WC_HOME_SINCE_UTC,
      homeSyndicationLimit: 100,
      homeTargetPerDay: 4,
      homeMinKeepFraction: 0.7,
      homeMaxKeepFraction: 0.9,
      homeDayTzOffsetHours: 3,
      homeDisplayDays: 3,
      homeRecentDays: 2,
      homeRecentTargetPerDay: 4,
      homeRecentMinKeepFraction: 0.5,
      homeRecentMaxKeepFraction: 0.85,
      homeTodayRampHours: 18,
      homeTodayMinLikes: 0,
      homeTodayMinAgeFactor: 0.05,
      matchFetchLimit: 50,
      universalTerms: [],
    };
  }
  return _memeSourcesCache;
}

function recentMemesRuntimeFresh(dayKey) {
  return _recentMemesRuntimeCache.dayKey === dayKey &&
    Date.now() - _recentMemesRuntimeCache.at < RECENT_MEMES_SCAN_CACHE_MS;
}

function updateRecentMemesRuntimeCache(memes, pending, dayKey) {
  const merged = orderMemesOldestFirst(memes).slice(0, RECENT_MEMES_LIMIT);
  const pendingList = orderMemesOldestFirst(pending || []).slice(0, RECENT_MEMES_LIMIT);
  _recentMemesRuntimeCache = {
    at: Date.now(),
    dayKey,
    memes: merged,
    pending: pendingList,
    seenIds: new Set([...merged, ...pendingList].map((m) => String(m.tweetId || m.url || "")).filter(Boolean)),
  };
  return merged;
}

/** Minimum likes to keep the top `keepFraction` of tweets (e.g. 0.75 → drop bottom 25%). */
function tweetSinceUtc(postedAt, sinceUtc) {
  const t = Date.parse(postedAt || "");
  const since = Date.parse(sinceUtc || "");
  return !isNaN(t) && !isNaN(since) && t >= since;
}

function refreshMemesFromPool(entries, pool) {
  const byId = new Map(pool.map((m) => [String(m.tweetId || m.url || ""), m]));
  return (entries || []).map((m) => {
    const fresh = byId.get(String(m.tweetId || m.url || ""));
    if (!fresh) return m;
    return {
      ...m,
      likes: fresh.likes ?? m.likes,
      retweets: fresh.retweets ?? m.retweets,
      engagement: fresh.engagement ?? m.engagement,
      text: fresh.text || m.text,
      media: fresh.media?.length ? fresh.media : m.media,
      postedAt: fresh.postedAt || m.postedAt,
    };
  });
}

async function collectAccountHomePool(acct, memeConfig, bearer, timelineCache) {
  const sinceUtc = memeConfig.homeSinceUtc || WC_HOME_SINCE_UTC;
  const syndLimit = memeConfig.homeSyndicationLimit || 100;
  const byId = new Map();
  const mergeEntry = (m) => {
    const id = String(m.tweetId || m.url || "");
    if (!id || !memeHasMedia(m) || !tweetSinceUtc(m.postedAt, sinceUtc)) return;
    if (String(m.author || "").toLowerCase() !== String(acct.username || "").toLowerCase()) return;
    const prev = byId.get(id);
    if (!prev || (Number(m.likes) || 0) > (Number(prev.likes) || 0)) byId.set(id, m);
  };

  if (bearer && acct.id) {
    try {
      const pack = await fetchAccountTweetsSince(
        bearer,
        acct.id,
        sinceUtc,
        new Date().toISOString()
      );
      for (const t of pack.tweets) {
        mergeEntry(memeToEntry(t, acct.username, pack.includes));
      }
    } catch { /* syndication supplements */ }
  }

  try {
    let tweets;
    if (timelineCache && timelineCache.has(acct.username)) {
      tweets = timelineCache.get(acct.username);
    } else {
      tweets = await fetchSyndicationTimeline(acct.username, syndLimit);
      if (timelineCache) timelineCache.set(acct.username, tweets);
    }
    for (const t of tweets) {
      mergeEntry(memeToEntry(t, acct.username, {}));
    }
  } catch { /* optional */ }

  return [...byId.values()];
}

async function fetchHomeViralMemes(memeConfig, bearer, timelineCache) {
  const config = memeConfig || {};
  const tz = config.homeDayTzOffsetHours ?? 3;
  const displayDays = config.homeDisplayDays || 3;
  const recentDays = config.homeRecentDays || 2;
  const dayKeys = recentMemeDayKeys(tz, displayDays);
  const homeKeys = config.homeAccounts || ["TrollFootball", "memesvsfootball"];
  const accounts = (config.accounts || []).filter((a) => homeKeys.includes(a.key));
  const thresholds = {};
  const recentThresholds = {};
  const accountStats = {};
  const recentAccountStats = {};
  const memes = [];
  const pending = [];

  const accountRows = await Promise.all(
    accounts.map(async (acct) => {
      const pool = await collectAccountHomePool(acct, config, bearer, timelineCache);
      const stats = computeAccountLikesThreshold(pool, config);
      const recentPool = pool.filter((m) => memeIsRecent(m.postedAt, tz, recentDays));
      const recentStats = computeRecentAccountThreshold(recentPool, config, stats);
      const hits = [];
      const waiting = [];
      for (const m of pool) {
        const row = classifyHomeMeme(m, stats, recentStats, config, tz, displayDays);
        if (!row) continue;
        if (row.passing) hits.push(row.entry);
        else if (row.isRecent) waiting.push(row.entry);
      }
      return { username: acct.username, stats, recentStats, hits, pending: waiting };
    })
  );

  for (const row of accountRows) {
    thresholds[row.username] = row.stats.threshold;
    recentThresholds[row.username] = row.recentStats.threshold;
    accountStats[row.username] = row.stats;
    recentAccountStats[row.username] = row.recentStats;
    memes.push(...row.hits);
    pending.push(...row.pending);
  }

  return {
    memes: orderMemesOldestFirst(memes),
    pending: orderMemesOldestFirst(pending),
    thresholds,
    recentThresholds,
    accountStats,
    recentAccountStats,
    displayDays,
    recentDays,
    dayKeys,
  };
}

async function recheckPendingHomeMemes(pending, memeConfig, bearer, timelineCache) {
  if (!pending?.length) return { memes: [], pending: [] };
  const config = memeConfig || {};
  const tz = config.homeDayTzOffsetHours ?? 3;
  const displayDays = config.homeDisplayDays || 3;
  const recentDays = config.homeRecentDays || 2;
  const homeKeys = config.homeAccounts || ["TrollFootball", "memesvsfootball"];
  const accounts = (config.accounts || []).filter((a) => homeKeys.includes(a.key));
  const pendingAuthors = new Set(pending.map((m) => String(m.author || "").toLowerCase()).filter(Boolean));
  const poolsByAuthor = new Map();

  await Promise.all(
    accounts
      .filter((acct) => pendingAuthors.has(String(acct.username || "").toLowerCase()))
      .map(async (acct) => {
        const pool = await collectAccountHomePool(acct, config, bearer, timelineCache);
        poolsByAuthor.set(String(acct.username || "").toLowerCase(), pool);
      })
  );

  const promoted = [];
  const stillPending = [];

  for (const acct of accounts) {
    const authorKey = String(acct.username || "").toLowerCase();
    const acctPending = pending.filter((m) => String(m.author || "").toLowerCase() === authorKey);
    if (!acctPending.length) continue;
    const pool = poolsByAuthor.get(authorKey) || [];
    const stats = computeAccountLikesThreshold(pool, config);
    const recentPool = pool.filter((m) => memeIsRecent(m.postedAt, tz, recentDays));
    const recentStats = computeRecentAccountThreshold(recentPool, config, stats);
    const refreshed = refreshMemesFromPool(acctPending, pool);
    for (const m of refreshed) {
      const row = classifyHomeMeme(m, stats, recentStats, config, tz, displayDays);
      if (!row) continue;
      if (row.passing) promoted.push(row.entry);
      else if (row.isRecent) stillPending.push(row.entry);
    }
  }

  return {
    memes: orderMemesOldestFirst(promoted),
    pending: orderMemesOldestFirst(stillPending),
  };
}

function mergeHomeMemeLists(base, extra) {
  const byId = new Map();
  for (const meme of [...(base || []), ...(extra || [])]) {
    const id = String(meme?.tweetId || meme?.url || "");
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev || (Number(meme.likes) || 0) > (Number(prev.likes) || 0)) byId.set(id, meme);
  }
  return orderMemesOldestFirst([...byId.values()]);
}

async function searchMatchMemesSyndication(home, away, match, memeConfig, timelineCache, seenIds) {
  const config = memeConfig || { accounts: [], matchFetchLimit: 50 };
  const limit = config.matchFetchLimit || 50;
  const out = [];
  for (const acct of config.accounts || []) {
    let tweets;
    try {
      if (timelineCache && timelineCache.has(acct.username)) {
        tweets = timelineCache.get(acct.username);
      } else {
        tweets = await fetchSyndicationTimeline(acct.username, limit);
        if (timelineCache) timelineCache.set(acct.username, tweets);
      }
    } catch {
      continue;
    }
    const hits = tweets
      .slice(0, limit)
      .filter((t) => !seenIds || !seenIds.has(String(t.id)))
      .filter((t) => memeCaptionRelates(t.text, home, away, match))
      .map((t) => memeToEntry(t, acct.username, {}));
    out.push(...hits);
  }
  return filterMemesWithMedia(out);
}

async function loadMemesIndex(env, origin) {
  if (_memesIdxCache) return _memesIdxCache;
  try {
    const res = await env.ASSETS.fetch(`${origin}/assets/data/match-memes.json`);
    _memesIdxCache = res.ok ? await res.json() : {};
  } catch {
    _memesIdxCache = {};
  }
  return _memesIdxCache;
}

async function loadPinnedMemes(env, origin) {
  if (_pinnedMemesCache) return _pinnedMemesCache;
  try {
    const res = await env.ASSETS.fetch(`${origin}/assets/data/pinned-match-memes.json`);
    _pinnedMemesCache = res.ok ? await res.json() : {};
  } catch {
    _pinnedMemesCache = {};
  }
  return _pinnedMemesCache;
}

function highlightPairKeyMemes(home, away) {
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  return [norm(home), norm(away)].sort().join("~");
}

async function proxyMatchMemesApi(request, env) {
  const url = new URL(request.url);
  const home = (url.searchParams.get("home") || "").trim();
  const away = (url.searchParams.get("away") || "").trim();
  const kickoff = url.searchParams.get("kickoff") || "";
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=1800",
    "X-KZ-Proxy": "match-memes-api",
  };
  if (!home || !away) {
    return new Response(JSON.stringify({ error: "home and away required" }), { status: 400, headers });
  }
  const key = highlightPairKeyMemes(home, away);
  const [idx, pinned, todayMatches, archiveMatches, memeConfig] = await Promise.all([
    loadMemesIndex(env, url.origin),
    loadPinnedMemes(env, url.origin),
    loadTodayMatches(env, url.origin),
    loadTournamentArchiveMatches(env, url.origin),
    loadMemeSources(env, url.origin),
  ]);
  const matchMeta = findMatchMeta(home, away, todayMatches, archiveMatches) ||
    { home, away, kickoffUtc: kickoff };
  const match = { ...matchMeta, home, away, kickoffUtc: kickoff || matchMeta.kickoffUtc };
  let memes = idx[key] || pinned[key] || [];
  let source = memes.length ? (pinned[key]?.length && !idx[key]?.length ? "pinned" : "archive") : "none";

  try {
    const synd = await searchMatchMemesSyndication(home, away, match, memeConfig);
    if (synd.length) {
      memes = mergeMemeLists(memes, synd);
      source = source === "none" ? "twitter-syndication" : `${source}+twitter-syndication`;
    }
  } catch { /* pinned/archive */ }

  if (!memes.length && pinned[key]?.length) {
    memes = pinned[key];
    source = "pinned";
  }

  // Worker TWITTER_BEARER_TOKEN — no GitHub secret needed. Runs when archive +
  // syndication are empty; edge-cached 30 min (withEdgeCache). ?live=1 forces refresh.
  const forceLive = url.searchParams.get("live") === "1";
  const bearer = readBearer(env);
  if (bearer && (forceLive || !memes.length)) {
    try {
      const live = await searchCuratedMemes(bearer, home, away, kickoff, match, memeConfig);
      if (live.length) {
        memes = mergeMemeLists(memes, live);
        source = source === "none" ? "twitter-curated" : `${source}+twitter-curated`;
      }
    } catch { /* static / syndication */ }
  }

  if (memes.length) {
    try {
      memes = await enrichMemesMedia(memes, bearer);
      if (source === "archive" || source === "pinned") source = "archive+media";
    } catch { /* text-only fallback */ }
    memes = filterMemesWithMedia(memes);
    const status = inferMemeStatusFromKickoff(match.kickoffUtc, match.status);
    memes = orderMemesByPostedAt(memes).map((meme) => ({
      ...meme,
      home: match.home,
      away: match.away,
      score: status === "upcoming" ? null : (match.score || meme.score || null),
      kickoffUtc: match.kickoffUtc || meme.kickoffUtc || null,
      status,
    }));
  }

  return new Response(JSON.stringify({ key, memes }), {
    status: 200,
    headers: { ...headers, "X-KZ-Meme-Source": source },
  });
}

async function loadTodayMatches(env, origin) {
  try {
    const res = await env.ASSETS.fetch(`${origin}/assets/data/today.json`);
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.matches) ? json.matches : [];
  } catch {
    return [];
  }
}

let _archiveMatchesCache = null;
let _archiveMatchesAt = 0;

async function loadTournamentArchiveMatches(env, origin) {
  if (_archiveMatchesCache && Date.now() - _archiveMatchesAt < 5 * 60 * 1000) return _archiveMatchesCache;
  try {
    const res = await env.ASSETS.fetch(`${origin}/assets/data/tournament-archive.json`);
    if (!res.ok) {
      _archiveMatchesCache = [];
    } else {
      const json = await res.json();
      _archiveMatchesCache = Array.isArray(json.matches) ? json.matches : [];
    }
  } catch {
    _archiveMatchesCache = [];
  }
  _archiveMatchesAt = Date.now();
  return _archiveMatchesCache;
}

function findMatchMeta(home, away, todayMatches, archiveMatches) {
  const key = highlightPairKeyMemes(home, away);
  return (
    todayMatches.find((m) => highlightPairKeyMemes(m.home, m.away) === key) ||
    archiveMatches.find((m) => highlightPairKeyMemes(m.home, m.away) === key) ||
    null
  );
}

function tweetPostedRecently(postedAt, sinceMs) {
  const t = Date.parse(postedAt || "");
  return !isNaN(t) && t >= sinceMs;
}

function matchKickoffRecently(kickoffUtc, sinceMs) {
  const t = Date.parse(kickoffUtc || "");
  return !isNaN(t) && t >= sinceMs;
}

// Home meme scroll source. The scroll originally aggregated memes across recent
// matches (match-memes.json); b4eb565 switched it to the viral-account timelines,
// but the free X profile-timeline syndication has since gone stale (years-old
// posts) and both configured accounts are dead/empty, so the scroll went blank.
// Rebuild it from the per-match memes we already have: gather every keyed match's
// memes (dedup, keep highest engagement), then hand to selectHomeScrollMemes,
// which takes the best of the last ~3 days and orders them newest-first.
async function collectRecentMatchMemes(env, origin) {
  const [idx, pinned, todayMatches, archiveMatches] = await Promise.all([
    loadMemesIndex(env, origin),
    loadPinnedMemes(env, origin),
    loadTodayMatches(env, origin),
    loadTournamentArchiveMatches(env, origin),
  ]);
  const matches = [...todayMatches, ...archiveMatches].filter((m) => m.home && m.away);
  const byId = new Map();
  for (const m of matches) {
    const key = highlightPairKeyMemes(m.home, m.away);
    for (const meme of [...(idx[key] || []), ...(pinned[key] || [])]) {
      const id = String(meme.tweetId || meme.url || "");
      if (!id) continue;
      const prev = byId.get(id);
      const better = (Number(meme.engagement) || Number(meme.likes) || 0);
      const prevScore = prev ? (Number(prev.engagement) || Number(prev.likes) || 0) : -1;
      if (!prev || better > prevScore) {
        byId.set(id, { ...meme, matchKey: key, matchHome: m.home, matchAway: m.away });
      }
    }
  }
  return selectHomeScrollMemes(filterMemesWithMedia([...byId.values()]));
}

// Safe live diagnostic (?diag=1): reveals whether the bearer reaches the worker
// and what X's API actually returns to it — status, error title, tweet count —
// without ever echoing the token. Used to tell "no token" / "bad token" /
// "wrong tier" / "rate limited" apart when the meme pool comes back empty.
async function recentMemesDiag(bearer, memeConfig) {
  const accounts = memeConfig.accounts || [];
  const acct = accounts.find((a) => a.id) || accounts[0] || null;
  const out = {
    bearerPresent: !!bearer,
    bearerLen: bearer ? bearer.length : 0,
    account: acct ? { username: acct.username, id: acct.id } : null,
  };
  if (bearer && acct && acct.id) {
    const params = new URLSearchParams({
      max_results: "10",
      "tweet.fields": "created_at,public_metrics",
      start_time: new Date(Date.now() - 7 * 86400000).toISOString(),
      exclude: "retweets,replies",
    });
    try {
      const res = await fetch(`${TWITTER_API_BASE}/users/${acct.id}/tweets?${params}`, {
        headers: { Authorization: `Bearer ${bearer}` },
      });
      out.apiStatus = res.status;
      const text = await res.text();
      try {
        const j = JSON.parse(text);
        out.tweetCount = (j.data || []).length;
        out.newestTweet = j.data?.[0]?.created_at || null;
        out.apiTitle = j.title || j.detail || j.reason || null;
      } catch {
        out.apiBodySnippet = text.slice(0, 200);
      }
    } catch (e) {
      out.apiError = String((e && e.message) || e);
    }
  }
  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "X-KZ-Proxy": "recent-memes-diag",
    },
  });
}

async function proxyRecentMemesApi(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=600",
    "X-KZ-Proxy": "recent-memes-api",
  };
  const memeConfig = await loadMemeSources(env, origin);
  const tz = memeConfig.homeDayTzOffsetHours ?? 3;
  const today = todayMemeDayKey(tz);
  const responseCacheKey = new Request(`${origin}/api/recent-memes/__response-cache/${today}`);
  const forceLive = url.searchParams.get("live") === "1";
  const bearer = readBearer(env);
  if (url.searchParams.get("diag") === "1") {
    return recentMemesDiag(bearer, memeConfig);
  }
  const timelineCache = new Map();
  const runtimePending = (_recentMemesRuntimeCache.pending || []).length;
  const runtimeReady = recentMemesRuntimeFresh(today) &&
    (_recentMemesRuntimeCache.memes.length || runtimePending);

  const buildResponse = (memes, meta, source) => {
    const body = JSON.stringify({
      memes,
      count: memes.length,
      day: today,
      displayDays: memeConfig.homeDisplayDays || 3,
      recentDays: memeConfig.homeRecentDays || 2,
      dayKeys: recentMemeDayKeys(tz, memeConfig.homeDisplayDays || 3),
      accounts: memeConfig.homeAccounts || ["TrollFootball", "memesvsfootball"],
      thresholds: meta.thresholds || {},
      recentThresholds: meta.recentThresholds || {},
      accountStats: meta.accountStats || {},
      recentAccountStats: meta.recentAccountStats || {},
      pendingCount: meta.pendingCount || 0,
      sinceUtc: memeConfig.homeSinceUtc || WC_HOME_SINCE_UTC,
      targetPerDay: memeConfig.homeTargetPerDay || 4,
      recentTargetPerDay: memeConfig.homeRecentTargetPerDay ?? memeConfig.homeTargetPerDay ?? 4,
      cached: !!meta.cached,
    });
    return new Response(body, {
      status: 200,
      headers: { ...headers, "X-KZ-Meme-Source": source },
    });
  };

  if (!forceLive) {
    if (runtimeReady) {
      let memes = filterMemesWithMedia(_recentMemesRuntimeCache.memes).slice(0, RECENT_MEMES_LIMIT);
      let pending = _recentMemesRuntimeCache.pending || [];
      if (runtimePending) {
        try {
          const recheck = await recheckPendingHomeMemes(pending, memeConfig, bearer, timelineCache);
          if (recheck.memes.length) {
            memes = mergeHomeMemeLists(memes, recheck.memes).slice(0, RECENT_MEMES_LIMIT);
            try {
              const enriched = await enrichMemesMedia(recheck.memes, bearer);
              memes = mergeHomeMemeLists(memes, filterMemesWithMedia(enriched)).slice(0, RECENT_MEMES_LIMIT);
            } catch { /* syndication counts enough */ }
          }
          pending = recheck.pending;
          updateRecentMemesRuntimeCache(memes, pending, today);
        } catch { /* keep cached memes */ }
      }
      return buildResponse(memes, { pendingCount: pending.length, cached: true }, runtimePending ? "runtime-recheck" : "runtime-cache");
    }
    if (!runtimePending) {
      try {
        const cached = await caches.default.match(responseCacheKey);
        if (cached) {
          const h = new Headers(cached.headers);
          h.set("X-KZ-Meme-Source", "edge-cache");
          return new Response(cached.body, { status: 200, headers: h });
        }
      } catch { /* cache optional */ }
    }
  }

  let thresholds = {};
  let recentThresholds = {};
  let accountStats = {};
  let recentAccountStats = {};
  let pending = [];
  let memes = [];
  try {
    const pack = await fetchHomeViralMemes(memeConfig, bearer, timelineCache);
    memes = pack.memes;
    pending = pack.pending || [];
    thresholds = pack.thresholds || {};
    recentThresholds = pack.recentThresholds || {};
    accountStats = pack.accountStats || {};
    recentAccountStats = pack.recentAccountStats || {};
  } catch { /* syndication optional */ }

  if (memes.length) {
    try {
      memes = await enrichMemesMedia(memes, bearer);
    } catch { /* static */ }
    memes = filterMemesWithMedia(memes).slice(0, RECENT_MEMES_LIMIT);
  }

  // When the viral-account pool is empty, populate the scroll from recent-match
  // memes (see collectRecentMatchMemes) so the home rail is never blank while a
  // live source is unavailable.
  let source = "home-viral-threshold";
  if (!memes.length) {
    try {
      const matchMemes = await collectRecentMatchMemes(env, origin);
      if (matchMemes.length) {
        memes = matchMemes;
        source = "recent-match-memes";
      }
    } catch { /* nothing to fall back to */ }
  }

  memes = updateRecentMemesRuntimeCache(memes, pending, today);

  const response = buildResponse(memes, {
    thresholds,
    recentThresholds,
    accountStats,
    recentAccountStats,
    pendingCount: pending.length,
    cached: false,
  }, source);
  if (!pending.length) {
    try {
      await caches.default.put(responseCacheKey, response.clone());
    } catch { /* cache optional */ }
  }
  return response;
}


function directFallbackUrls(channelId, slot, serv = 3) {
  const urls = [];
  const u = new URL(`${WORLDKOORA}/albaplayer/${slot}/`);
  u.searchParams.set("serv", String(serv));
  if (channelId) u.searchParams.set("ch", channelId);
  urls.push({ label: "worldkoora", url: u.toString() });
  for (const id of (DLHD_CHANNEL_MIRROR_IDS[channelId] || []).slice(0, 3)) {
    urls.push({ label: `dlhd-${id}`, url: `${DLHD_BASE}/stream/stream-${id}.php` });
  }
  return urls;
}

function workerEgressMeta(request) {
  const cf = request.cf || {};
  return {
    country: cf.country || null,
    colo: cf.colo || null,
    city: cf.city || null,
    region: cf.region || null,
    continent: cf.continent || null,
  };
}

function diagnosisNote(verdict, egress) {
  const where = egress.country ? `Worker egress: ${egress.country}${egress.colo ? ` (${egress.colo})` : ""}` : "Worker egress unknown";
  if (verdict === "likely_geo_block") {
    return `${where}. Master playlists load but variant/segment returns 403/451 — upstream likely geo/IP-gated from Cloudflare edge. Stream may still work in-browser in MENA on the raw site, but not via our proxy until mirror or egress changes.`;
  }
  if (verdict === "mixed_geo_and_dead") {
    return `${where}. Some mirrors geo-blocked, others dead — not a single root cause.`;
  }
  if (verdict === "working") {
    return `${where}. At least one mirror passed full HLS chain probe from this edge.`;
  }
  return `${where}. No mirror passed probe — upstream likely offline or URLs rotated.`;
}

async function mirrorDiagnosisRow(label, source, kind, request) {
  if (!source) return { label, source: null, playable: false, geoSuspect: false, failure: "no_url" };
  let host = null;
  try { host = new URL(source).hostname; } catch { /* noop */ }
  const chain = await probeHlsChain(source, kind, request);
  return {
    label,
    host,
    source: source.slice(0, 180),
    playable: !!chain.ok,
    geoSuspect: !!chain.geoSuspect,
    failure: chain.failure || null,
    soft: !!chain.soft,
    ms: chain.ms,
    steps: chain.steps,
  };
}

async function proxyStreamDiagnoseApi(request, env) {
  const url = new URL(request.url);
  const channelId = url.searchParams.get("ch") || "bein-max-1";
  const slot = (url.searchParams.get("slot") || "vip1").toLowerCase();
  const egress = workerEgressMeta(request);
  const probeUrl = new URL(`${url.origin}/wk/albaplayer/${slot}/`);
  probeUrl.searchParams.set("ch", channelId);
  if (url.searchParams.get("serv")) probeUrl.searchParams.set("serv", url.searchParams.get("serv"));
  if (url.searchParams.get("match")) probeUrl.searchParams.set("match", url.searchParams.get("match"));
  const probeRequest = new Request(probeUrl.toString(), {
    method: "GET",
    headers: request.headers,
  });

  const mirrors = [];
  const dlIds = DLHD_CHANNEL_MIRROR_IDS[channelId] || [];
  const dlProbeIds = [...new Set([...dlIds, ...GLOBAL_DLHD_FALLBACK_IDS])].slice(0, 6);
  for (const id of dlProbeIds) {
    const m3u8 = await resolveDlStream(id);
    mirrors.push(await mirrorDiagnosisRow(`dlhd-${id}`, m3u8, "dl", probeRequest));
  }

  try {
    const { candidates } = await resolveVipSlotStreamQuick(probeRequest, slot);
    for (const c of (candidates || []).slice(0, 4)) {
      mirrors.push(await mirrorDiagnosisRow(`worldkoora-${slot}-serv${c.serv || "?"}`, c.source, "wk", probeRequest));
    }
  } catch { /* vip optional */ }

  try {
    const sirHtml = await fetchSirTvCh1Html(probeRequest);
    if (sirHtml) {
      for (const c of extractHlsCandidates(sirHtml).slice(0, 2)) {
        mirrors.push(await mirrorDiagnosisRow("sirtv-ch1", c.source, "plain", probeRequest));
      }
    }
  } catch { /* sirtv optional */ }

  const verdict = streamVerdictFromMirrors(mirrors);
  const directFallbacks = directFallbackUrls(channelId, slot, url.searchParams.get("serv") || 3);
  const viewer = workerEgressMeta(request);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "X-KZ-Proxy": "stream-diagnose",
    "X-KZ-Stream-Verdict": verdict,
    "X-KZ-Worker-Country": egress.country || "",
  };
  if (verdict === "likely_geo_block" || verdict === "mixed_geo_and_dead") {
    headers["X-KZ-Stream-Geo-Suspect"] = "1";
  }

  return new Response(JSON.stringify({
    ok: true,
    at: new Date().toISOString(),
    channelId,
    slot,
    workerEgress: egress,
    viewerCountry: viewer.country,
    viewerColo: viewer.colo,
    verdict,
    note: diagnosisNote(verdict, egress),
    geoSuspect: verdict === "likely_geo_block" || verdict === "mixed_geo_and_dead",
    proxyPlayable: mirrors.some((m) => m.playable),
    directMayWork: (verdict === "likely_geo_block" || verdict === "mixed_geo_and_dead"),
    directFallbacks,
    playableCount: mirrors.filter((m) => m.playable).length,
    geoBlockedCount: mirrors.filter((m) => m.geoSuspect).length,
    mirrors,
  }), { status: 200, headers });
}

function proxyEdgeApi(request) {
  const cf = request.cf || {};
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "X-KZ-Proxy": "edge-api",
  };
  return new Response(JSON.stringify({
    country: cf.country || null,
    colo: cf.colo || null,
    city: cf.city || null,
    timezone: cf.timezone || null,
    region: cf.region || null,
    regionCode: cf.regionCode || null,
    continent: cf.continent || null,
    tcpRttMs: cf.clientTcpRtt || null,
    ok: true,
  }), { status: 200, headers });
}

async function proxyTwitchApi(request, env) {
  const url = new URL(request.url);
  const slot = (url.searchParams.get("slot") || "vip1").toLowerCase();
  const channelId = url.searchParams.get("ch") || "";
  const match = await resolveMatchForTwitch(request, env, channelId);
  const upstream = await scrapeTwitchUpstream(request, slot, []);
  const config = await loadTwitchConfig(env);
  const slotCfg = (config.slots && config.slots[slot]) || {};
  const configCandidates = [
    ...(slotCfg.candidates || []),
    ...(config.globalCandidates || []),
  ];
  const cacheKey = twitchCacheKey(slot, channelId, match);
  const searchLogins = await discoverTwitchSearchLogins(match, [...upstream, ...configCandidates], env);
  const streams = await twitchHelixLiveStreams(searchLogins, env);
  const helixReady = !!(env && env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET);

  const statuses = searchLogins.map((login) => {
    const stream = streams.find((s) => String(s.user_login).toLowerCase() === login.toLowerCase());
    const pureTv = stream ? isPureTvTwitchStream(stream) : false;
    return {
      login,
      live: !!stream,
      pureTv,
      game: stream ? stream.game_name : null,
      title: stream ? stream.title : null,
      viewers: stream ? stream.viewer_count : 0,
      titleScore: stream && match ? scoreStreamTitleForMatch(stream.title, match) : 0,
      source: upstream.includes(login) ? "upstream" : "search",
    };
  }).filter((row) => row.live && row.pureTv)
    .sort((a, b) => b.titleScore - a.titleScore || b.viewers - a.viewers);

  let resolved = null;
  if (helixReady) {
    resolved = await pickLiveTwitchForMatch(match, upstream, configCandidates, env);
    if (!resolved) resolved = await pickLiveTwitchChannel(searchLogins, env, upstream);
  } else {
    resolved = upstream[0] || null;
  }

  return new Response(JSON.stringify({
    ok: true,
    slot,
    channelId: channelId || null,
    match: match ? { id: match.id, home: match.home, away: match.away, channel: match.channel } : null,
    resolved,
    helix: helixReady,
    upstream,
    searchLogins,
    statuses,
    cache: LAST_KNOWN_TWITCH_CHANNELS[cacheKey] || null,
  }, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "X-KZ-Proxy": "twitch-api",
    },
  });
}

let _streamsLabCache = { at: 0, data: null };
const STREAMS_LAB_CACHE_MS = 45_000;
let _siirMatchesCache = { at: 0, data: null };
const SIIR_MATCHES_CACHE_MS = 60_000;

async function loadStreamsLabCatalog(env, origin) {
  try {
    const res = await env.ASSETS.fetch(new URL("/assets/data/streams-lab.json", origin));
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchSiirHtml(pathOrUrl) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${SIIR_BASE}${pathOrUrl}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": SIIR_FETCH_UA, Accept: "text/html" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

function siirStatusFromClass(cls) {
  const c = String(cls || "");
  if (/\blive\b|started|gools/.test(c)) return "live";
  if (/end|finished/.test(c)) return "ended";
  if (/comming-soon|soon|not-start/.test(c)) return "soon";
  return "unknown";
}

function parseSiirMatchBlocks(html) {
  const blocks = [];
  const parts = String(html || "").split(/<div class='match-container /);
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    const statusClass = (chunk.match(/^([^']*)'/) || [])[1] || "";
    const teams = [...chunk.matchAll(/class='team-name'>([^<]+)<\/div>/g)].map((m) => m[1].trim());
    const href = (chunk.match(/<a class='ahmed'[^>]*href="([^"]+)"/) || [])[1];
    const title = (chunk.match(/<a class='ahmed'[^>]*title='([^']*)'/) || [])[1];
    const channel = (chunk.match(/<li><span>([^<]+)<\/span><\/li>/) || [])[1];
    const time = (chunk.match(/class='match-time'>([^<]+)<\/div>/) || [])[1];
    const score = (chunk.match(/class='result'>([^<]+)<\/div>/) || [])[1];
    if (!href) continue;
    blocks.push({
      statusClass,
      status: siirStatusFromClass(statusClass),
      home: teams[0] || "",
      away: teams[1] || "",
      href,
      title: title || `${teams[0] || ""} vs ${teams[1] || ""}`,
      channel: channel || "",
      time: time || "",
      score: score || "",
    });
  }
  return blocks;
}

function extractSiirEmbeds(html) {
  const text = String(html || "");
  const iframes = [...text.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map((m) => m[1]);
  const shootny = [...text.matchAll(/https?:\/\/[^"'\s<>]*shootny[^"'\s<>]*/gi)].map((m) => m[0]);
  const servers = [];
  for (const block of text.matchAll(/<div class="video-serv"[^>]*>([\s\S]*?)<\/div>/gi)) {
    for (const a of block[1].matchAll(/href="([^"]+)"/g)) servers.push(a[1]);
    for (const s of block[1].matchAll(/data-url="([^"]+)"/g)) servers.push(s[1]);
  }
  return { iframes, shootny, servers };
}

function siirPostIdFromHtml(html) {
  const m = String(html || "").match(/postid-(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

async function fetchSirPlayerHtmlForMatch(matchId) {
  const id = encodeURIComponent(String(matchId));
  for (const referer of SIR_REFERRERS) {
    try {
      const res = await fetch(`${SIR_PLAYER}?match=${id}&key=${SIR_KEY}`, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html", Referer: referer },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (sirDecodeConfig(html) || /shootny|playerv5/i.test(html)) return html;
    } catch { /* try next referer */ }
  }
  return null;
}

async function resolveSirMasterFromHtml(html) {
  const decoded = sirDecodeConfig(html);
  if (!decoded?.cfg?.tabs?.length) return null;
  const tab = decoded.cfg.tabs.find((t) => t.type === "regular" && t.path) || decoded.cfg.tabs.find((t) => t.path);
  if (!tab?.path) return null;
  const domains = decoded.cfg.activeDomains?.length
    ? decoded.cfg.activeDomains
    : ["https://1rxolmirvosixpyfy.foozlive.co/"];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  const cleanDomain = domain.endsWith("/") ? domain : domain + "/";
  return sirSign(cleanDomain, sirRewritePath(tab.path), decoded.secret);
}

async function probeSiirMatchDetail(block) {
  const pageHtml = await fetchSiirHtml(block.href);
  const postId = pageHtml ? siirPostIdFromHtml(pageHtml) : null;
  const embeds = pageHtml ? extractSiirEmbeds(pageHtml) : { iframes: [], shootny: [], servers: [] };
  const hasEmbed = !!(embeds.iframes.length || embeds.shootny.length || embeds.servers.length);
  const status = hasEmbed && block.status !== "ended" ? "live" : block.status;
  const id = postId ? String(postId) : null;
  return {
    id: id || block.href,
    postId,
    title: block.title,
    home: block.home,
    away: block.away,
    status,
    channel: block.channel,
    time: block.time,
    score: block.score,
    url: block.href,
    route: id ? `/siir/m/${id}` : null,
    live: status === "live",
    embed: hasEmbed ? { iframes: embeds.iframes.slice(0, 3), shootny: embeds.shootny.slice(0, 3) } : null,
  };
}

const SIIR_MATCHES_DETAIL_LIMIT = 16;

async function proxySiirMatchesApi(request, env) {
  const now = Date.now();
  if (_siirMatchesCache.data && now - _siirMatchesCache.at < SIIR_MATCHES_CACHE_MS) {
    return new Response(JSON.stringify(_siirMatchesCache.data), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
        "X-KZ-Proxy": "siir-matches",
        "X-KZ-Cache": "hit",
      },
    });
  }

  const [homeHtml, todayHtml] = await Promise.all([fetchSiirHtml("/"), fetchSiirHtml("/todays-matches/")]);
  const rawBlocks = [
    ...parseSiirMatchBlocks(homeHtml || ""),
    ...parseSiirMatchBlocks(todayHtml || ""),
  ];
  const seen = new Set();
  const blocks = rawBlocks
    .filter((b) => {
      if (seen.has(b.href)) return false;
      seen.add(b.href);
      return true;
    })
    .slice(0, SIIR_MATCHES_DETAIL_LIMIT);

  const matches = await mapPool(blocks, 4, probeSiirMatchDetail);

  const sir247 = await mapPool(
    [
      { slug: "ar1", name: "SIR AR 1", route: "/sir/ar1" },
      { slug: "ar2", name: "SIR AR 2", route: "/sir/ar2" },
      { slug: "fr", name: "SIR FR", route: "/sir/fr" },
      { slug: "en", name: "SIR EN", route: "/sir/en" },
    ],
    2,
    async (ch) => {
      const master = await resolveSirMaster(ch.slug);
      return { ...ch, live: !!master, group: ch.slug.startsWith("ar") ? "sir" : "other" };
    }
  );

  const payload = {
    ok: true,
    updatedAt: new Date().toISOString(),
    source: SIIR_BASE,
    matchCount: matches.length,
    liveCount: matches.filter((m) => m.live).length,
    matches,
    sir247,
  };

  _siirMatchesCache = { at: now, data: payload };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
      "X-KZ-Proxy": "siir-matches",
      "X-KZ-Cache": "miss",
    },
  });
}

async function proxySiirMatchEmbed(request, postId, env) {
  const origin = new URL(request.url).origin;
  const secret = env && env.STREAM_SIGNING_SECRET;
  const htmlHeaders = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-KZ-Proxy": "siir-match",
  };

  const playerHtml = await fetchSirPlayerHtmlForMatch(postId);
  if (playerHtml) {
    const master = await resolveSirMasterFromHtml(playerHtml);
    if (master) {
      const sig = await signTarget(master, secret);
      const src = hlsProxyUrl(master, origin, sig, "/sir/hls");
      return new Response(sirPlayerHtml(src, "ar1"), { status: 200, headers: htmlHeaders });
    }
  }

  const playerUrl = `${SIR_PLAYER}?match=${encodeURIComponent(postId)}&key=${SIR_KEY}`;
  const frame = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>siir-tv.live — مباراة ${postId}</title>
<style>html,body{margin:0;height:100%;background:#000}iframe{width:100%;height:100%;border:0;display:block}</style>
</head><body><iframe src="${playerUrl}" allow="autoplay;encrypted-media;fullscreen;picture-in-picture" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" referrerpolicy="no-referrer"></iframe></body></html>`;
  return new Response(frame, { status: 200, headers: htmlHeaders });
}

async function probeDlhdLabLive(dlhdId) {
  const m3u8 = await resolveDlStream(dlhdId);
  return !!(m3u8 && isHlsUrl(m3u8));
}

async function probeStreamsLabEntry(ch, origin, secret, request) {
  if (ch.dlhdId) {
    // Light probe: resolveDlStream only (same check as /dl/{id} embed page).
    // Full streamProbe was marking working channels dead in the lab API.
    if (await probeDlhdLabLive(ch.dlhdId)) {
      return { live: true, route: ch.route, mirror: null };
    }
    for (const mirrorRoute of ch.mirrors || []) {
      const mid = parseInt(String(mirrorRoute).replace(/.*\//, ""), 10);
      if (!mid) continue;
      if (await probeDlhdLabLive(mid)) {
        return { live: true, route: mirrorRoute, mirror: mirrorRoute };
      }
    }
    return { live: false, route: ch.route, mirror: null };
  }
  if (ch.sirSlug) {
    const master = await resolveSirMaster(ch.sirSlug);
    return { live: !!master, route: ch.route, mirror: null };
  }
  return { live: false, route: ch.route, mirror: null };
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

async function proxyStreamsLabApi(request, env) {
  const origin = new URL(request.url).origin;
  const now = Date.now();
  if (_streamsLabCache.data && now - _streamsLabCache.at < STREAMS_LAB_CACHE_MS) {
    return new Response(JSON.stringify(_streamsLabCache.data), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
        "X-KZ-Proxy": "streams-lab",
        "X-KZ-Cache": "hit",
      },
    });
  }

  const catalog = await loadStreamsLabCatalog(env, origin);
  if (!catalog || !Array.isArray(catalog.channels)) {
    return new Response(JSON.stringify({ ok: false, error: "catalog missing" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const secret = env && env.STREAM_SIGNING_SECRET;
  const channels = await mapPool(catalog.channels, 4, async (ch) => {
    const probe = await probeStreamsLabEntry(ch, origin, secret, request);
    return {
      id: ch.id,
      name: ch.name,
      sub: ch.sub,
      group: ch.group,
      source: ch.source,
      route: probe.route,
      primaryRoute: ch.route,
      live: probe.live,
      mirror: probe.mirror,
      priority: ch.priority || 99,
    };
  });

  const liveCount = channels.filter((c) => c.live === true).length;
  const primaryGroups = new Set(catalog.primaryGroups || ["ar", "max", "sir"]);
  const groupRank = (g) => (primaryGroups.has(g) ? primaryGroups.size - [...primaryGroups].indexOf(g) : 0);
  const liveChannels = channels.filter((c) => c.live === true);
  const primaryLive = liveChannels.filter((c) => primaryGroups.has(c.group));
  const bestPool = primaryLive.length ? primaryLive : liveChannels;
  const best = bestPool.sort((a, b) => groupRank(b.group) - groupRank(a.group) || a.priority - b.priority)[0] || null;

  const payload = {
    ok: true,
    updatedAt: new Date().toISOString(),
    liveCount,
    total: channels.length,
    best,
    groups: catalog.groups || [],
    external: catalog.external || [],
    channels,
  };

  _streamsLabCache = { at: now, data: payload };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
      "X-KZ-Proxy": "streams-lab",
      "X-KZ-Cache": "miss",
    },
  });
}


export default {
  async fetch(request, env, ctx) {
    const routed = await dispatchBackendRoutes(backendRoutes, request, env, ctx);
    if (routed) return routed;

    const url = new URL(request.url);
    const method = request.method;
    const vip = url.pathname.match(VIP_RE);
    if (vip && (method === "GET" || method === "HEAD")) {
      return proxyVip(request, vip[1].toLowerCase(), env);
    }
    if (WESHAN_RE.test(url.pathname) && (method === "GET" || method === "HEAD")) {
      return proxyWeshan(request, env);
    }
    if (SIRTV_RE.test(url.pathname) && (method === "GET" || method === "HEAD")) {
      return proxySirTv(request, env);
    }
    if (KOORACITY_RE.test(url.pathname) && (method === "GET" || method === "HEAD")) {
      return proxyKooraCity(request, env);
    }
    if (NTV_RE.test(url.pathname) && (method === "GET" || method === "HEAD")) {
      return proxyNtv(request, env);
    }
    if (AMINE_RE.test(url.pathname) && (method === "GET" || method === "HEAD")) {
      return proxyAmine(request, env);
    }
    if (KORAPLUS_RE.test(url.pathname) && (method === "GET" || method === "HEAD")) {
      return proxyKoraPlus(request, env);
    }
    if (DADDY_RE.test(url.pathname) && (method === "GET" || method === "HEAD")) {
      return proxyDaddy(request, env);
    }
    if (AEROZAST_RE.test(url.pathname) && (method === "GET" || method === "HEAD")) {
      return proxyAerozast(request, env);
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
      const ttl = (url.searchParams.get("u") || "").includes(".m3u8") ? 2 : 60;
      return withEdgeCache(request, ttl, () => proxyHls(request, env));
    }
    const dl = url.pathname.match(DL_EMBED_RE);
    if (dl && (method === "GET" || method === "HEAD")) {
      return proxyDlEmbed(request, dl[1], env);
    }
    const labDl = url.pathname.match(LAB_DL_EMBED_RE);
    if (labDl && (method === "GET" || method === "HEAD")) {
      return proxyLabDlEmbed(request, labDl[1], env);
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
      return withEdgeCache(request, (url.searchParams.get("u") || "").includes(".m3u8") ? 2 : 60, () =>
        proxyDlHls(request, env)
      );
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
    const poll = url.pathname.match(POLL_RE);
    if (poll) {
      return handlePoll(request, poll[1].toLowerCase(), env);
    }
    if (HIGHLIGHT_API_RE.test(url.pathname) && method === "GET") {
      return withEdgeCache(request, 3600, () => proxyHighlightApi(request, env));
    }
    const replayEmbed = url.pathname.match(REPLAY_EMBED_RE);
    if (replayEmbed && (method === "GET" || method === "HEAD")) {
      return withEdgeCache(request, 300, () => proxyReplayEmbed(request, replayEmbed[1]));
    }
    if (REPLAY_ASSET_RE.test(url.pathname) && (method === "GET" || method === "HEAD" || method === "OPTIONS")) {
      return proxyReplayAsset(request);
    }
    if (MEMES_API_RE.test(url.pathname) && method === "GET") {
      return withEdgeCache(request, 1800, () => proxyMatchMemesApi(request, env));
    }
    if (RECENT_MEMES_API_RE.test(url.pathname) && method === "GET") {
      return withEdgeCache(request, 600, () => proxyRecentMemesApi(request, env));
    }
    if (X_MEDIA_API_RE.test(url.pathname) && (method === "GET" || method === "HEAD" || method === "OPTIONS")) {
      return proxyXMedia(request);
    }
    if (EDGE_API_RE.test(url.pathname) && method === "GET") {
      return proxyEdgeApi(request);
    }
    if (STREAM_DIAGNOSE_RE.test(url.pathname) && method === "GET") {
      return proxyStreamDiagnoseApi(request, env);
    }
    if (XTREAM_API_RE.test(url.pathname) && (method === "GET" || method === "OPTIONS")) {
      const action = url.pathname.match(XTREAM_API_RE)[1].toLowerCase();
      return proxyXtreamApi(request, env, action);
    }
    if (TWITCH_API_RE.test(url.pathname) && method === "GET") {
      return proxyTwitchApi(request, env);
    }
    if (STREAMS_LAB_RE.test(url.pathname) && method === "GET") {
      return proxyStreamsLabApi(request, env);
    }
    if (SIIR_MATCHES_RE.test(url.pathname) && method === "GET") {
      return proxySiirMatchesApi(request, env);
    }
    const siirMatch = url.pathname.match(SIIR_MATCH_EMBED_RE);
    if (siirMatch && (method === "GET" || method === "HEAD")) {
      return proxySiirMatchEmbed(request, siirMatch[1], env);
    }
    return env.ASSETS.fetch(request);
  },
};
