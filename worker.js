/**
 * morshlive worker — static site + worldkoora vip proxy without preroll ads.
 *
 * /wk/albaplayer/vip1|vip2/ fetches vip.worldkoora.com server-side, strips
 * preroll + embed-guard scripts, rewrites stream URLs through /wk/hls (spoofed
 * Referer), and serves player HTML from korazero.com so the iframe stays clean.
 */
const WORLDKOORA = "https://vip.worldkoora.com";
const VIP_RE = /^\/wk\/albaplayer\/(vip[12])\/?$/i;
const HLS_RE = /^\/wk\/hls$/i;

const ALLOWED_STREAM_HOST =
  /(^|\.)((heinzromanigi|teworld|smarop)\.[a-z0-9.-]+|(cdn[0-9]?\.)?heinzromanigi1\.xyz|za\.teworld\.online|we\.smarop\.store|mashy\.[a-z0-9.-]+)$/i;

const HIDE_OVERLAY_STYLE = `<style id="kz-no-ads">
.aplr-fxd-bnr,#aplr-fixedban,
[class^="agl-"],[class*=" agl-"],[id^="agl-"],
.aplr-ad,.aplr-preroll,.video-ad,.vjs-ad,.ima-ad-container,
.aplr-embed-holder,.aplr-embed-visible,.aplr-site-name{display:none!important;visibility:hidden!important;pointer-events:none!important}
</style>`;

const EMBED_SHIM = `<script id="kz-embed-shim">
(function(){
  var WK='https://vip.worldkoora.com';
  window.AplrDevprotocol='0';
  window.AplrDevredirect='';
  window.AplrPopUp=function(){};
  var fakeLoc={hostname:'vip.worldkoora.com',host:'vip.worldkoora.com',href:WK+'/',origin:WK,protocol:'https:',pathname:'/',search:'',hash:'',toString:function(){return WK+'/';}};
  var fakeWin={location:fakeLoc};
  try{
    Object.defineProperty(window,'top',{get:function(){return fakeWin;},configurable:true});
    Object.defineProperty(window,'parent',{get:function(){return fakeWin;},configurable:true});
  }catch(e){}
  try{
    Object.defineProperty(document,'referrer',{get:function(){return WK+'/albaplayer/vip1/';},configurable:true});
  }catch(e){}
})();
</script>`;

function stripBlockedScripts(html) {
  return String(html || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (block) => {
    if (/agl006\.host|aplr-fxd-bnr|cvt-s\d*\.agl/i.test(block)) return "";
    if (/AplrDevprotocol|ConsoleBan\.init|ConsoleBan\.prototype/i.test(block)) return "";
    return block;
  });
}

function hlsProxyUrl(target, origin) {
  return `${origin}/wk/hls?u=${encodeURIComponent(target)}`;
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

function rewriteM3u8(body, manifestUrl, origin) {
  const base = manifestUrl.replace(/[^/]+$/, "");
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
          const abs = resolveStreamUrl(uri, manifestUrl);
          return isAllowedStreamUrl(abs) ? `URI="${hlsProxyUrl(abs, origin)}"` : `URI="${uri}"`;
        });
      }
      const abs = resolveStreamUrl(trimmed, base || manifestUrl);
      return isAllowedStreamUrl(abs) ? hlsProxyUrl(abs, origin) : trimmed;
    })
    .join("\n");
}

function rewriteStreamUrlsInHtml(html, origin) {
  let out = html;
  out = out.replace(
    /(<(?:source|video)\b[^>]*\ssrc=)(["'])(https?:\/\/[^"']+)\2/gi,
    (m, pre, q, url) => (isAllowedStreamUrl(url) ? `${pre}${q}${hlsProxyUrl(url, origin)}${q}` : m)
  );
  out = out.replace(/AlbaPlayerControl\('([A-Za-z0-9+/=]*)','([^']+)'\)/g, (m, b64, player) => {
    if (!b64) return m;
    try {
      const raw = atob(b64);
      if (!/^https?:\/\//i.test(raw) || !isAllowedStreamUrl(raw)) return m;
      const proxied = hlsProxyUrl(raw, origin);
      const enc = btoa(proxied);
      return `AlbaPlayerControl('${enc}','${player}')`;
    } catch {
      return m;
    }
  });
  return out;
}

function cleanWorldkooraHtml(html, slot, origin) {
  let out = stripBlockedScripts(html);
  out = rewriteStreamUrlsInHtml(out, origin);
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

async function proxyHls(request) {
  const incoming = new URL(request.url);
  const origin = incoming.origin;
  const target = incoming.searchParams.get("u");
  if (!target || !isAllowedStreamUrl(target)) {
    return new Response("Forbidden stream host", { status: 403 });
  }

  const referer = `${WORLDKOORA}/albaplayer/vip1/?serv=1`;
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
      return new Response(`Upstream error ${res.status}`, { status: res.status });
    }

    const type = (res.headers.get("Content-Type") || "").toLowerCase();
    const isManifest = type.includes("mpegurl") || type.includes("m3u8") || target.includes(".m3u8");

    if (isManifest) {
      const text = await res.text();
      const rewritten = rewriteM3u8(text, target, origin);
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

    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
        "Cache-Control": "public, max-age=30",
        "Access-Control-Allow-Origin": "*",
        "X-KZ-Proxy": "hls-segment",
      },
    });
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }
}

async function proxyVip(request, slot) {
  const incoming = new URL(request.url);
  const upstream = new URL(`${WORLDKOORA}/albaplayer/${slot}/`);
  upstream.search = incoming.search;

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

    if (!res.ok) {
      return new Response(`Upstream error ${res.status}`, { status: res.status });
    }

    const html = await res.text();
    const origin = new URL(request.url).origin;
    return new Response(cleanWorldkooraHtml(html, slot, origin), {
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
    const vip = url.pathname.match(VIP_RE);
    if (vip && request.method === "GET") {
      return proxyVip(request, vip[1].toLowerCase());
    }
    if (HLS_RE.test(url.pathname) && request.method === "GET") {
      return proxyHls(request);
    }
    return env.ASSETS.fetch(request);
  },
};
