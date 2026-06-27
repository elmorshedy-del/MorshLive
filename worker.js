/**
 * morshlive worker — static site + worldkoora vip proxy without preroll ads.
 *
 * /wk/albaplayer/vip1|vip2/ fetches vip.worldkoora.com server-side, strips the
 * geo-targeted preroll injector (agl006.host), and hides fixed overlays — then
 * serves the same Clappr player HTML from korazero.com so the iframe stays clean.
 */
const WORLDKOORA = "https://vip.worldkoora.com";
const VIP_RE = /^\/wk\/albaplayer\/(vip[12])\/?$/i;

const HIDE_AD_STYLE = `<style id="kz-no-ads">
.aplr-fxd-bnr,#aplr-fixedban,
[class^="agl-"],[class*=" agl-"],[id^="agl-"],
.aplr-ad,.aplr-preroll,.video-ad,.vjs-ad,.ima-ad-container{display:none!important;visibility:hidden!important;pointer-events:none!important}
</style>`;

function stripAdScripts(html) {
  return String(html || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (block) =>
    /agl006\.host|aplr-fxd-bnr|cvt-s\d*\.agl/i.test(block) ? "" : block
  );
}

function cleanWorldkooraHtml(html) {
  let out = stripAdScripts(html);
  const headClose = /<\/head>/i;
  if (headClose.test(out)) {
    out = out.replace(headClose, HIDE_AD_STYLE + "</head>");
  } else {
    out = HIDE_AD_STYLE + out;
  }
  return out;
}

async function proxyVip(request, slot, ctx) {
  const incoming = new URL(request.url);
  const cacheKey = new Request(incoming.toString(), { method: "GET" });
  const edge = caches.default;
  const cached = await edge.match(cacheKey);
  if (cached) {
    return cached;
  }

  const upstream = new URL(`${WORLDKOORA}/albaplayer/${slot}/`);
  upstream.search = incoming.search;

  try {
    const res = await fetch(upstream.toString(), {
      method: "GET",
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://korazero.com/",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return new Response(`Upstream error ${res.status}`, { status: res.status });
    }

    const html = await res.text();
    const response = new Response(cleanWorldkooraHtml(html), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=30",
        "CDN-Cache-Control": "max-age=60, stale-while-revalidate=120",
        "X-KZ-Proxy": "worldkoora-vip",
      },
    });
    ctx.waitUntil(edge.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return new Response("Upstream unavailable", { status: 502 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const vip = url.pathname.match(VIP_RE);
    if (vip && request.method === "GET") {
      return proxyVip(request, vip[1].toLowerCase(), ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
