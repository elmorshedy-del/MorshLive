/**
 * morshlive worker — static assets + worldkoora vip proxy without Yalla Score overlay.
 * /wk/albaplayer/vip1|vip2/ fetches vip.worldkoora.com and strips ads/overlays.
 */
const WORLDKOORA = "https://vip.worldkoora.com";
const VIP_RE = /^\/wk\/albaplayer\/(vip[12])\/?$/i;

const INJECT_HEAD = [
  "<style id=\"kz-clean\">",
  ".aplr-fxd-bnr,#aplr-fixedban,.aplr-share-popup,.aplr-popup{display:none!important;visibility:hidden!important;pointer-events:none!important}",
  "html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#000}",
  ".aplr-player-wrapper,.aplr-player-content{height:100%!important;min-height:100%!important}",
  "#aplr-video,.clappr-container,.container[data-container],.player-poster{width:100%!important;height:100%!important;min-height:100%!important}",
  ".aplr-menu{display:none!important}",
  "</style>",
  "<script id=\"kz-clean-js\">",
  "(function(){function n(){",
  "var b=document.getElementById('aplr-fixedban')||document.querySelector('.aplr-fxd-bnr');if(b)b.remove();",
  "document.querySelectorAll('.aplr-share-popup,.aplr-popup').forEach(function(e){e.remove()});",
  "}",
  "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',n);else n();",
  "})();",
  "</script>",
].join("");

function stripScripts(html) {
  return String(html || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (block) => {
    if (/cvt-s1\.agl006\.host|ConsoleBan|aclib\.runInPagePush/i.test(block)) return "";
    return block;
  });
}

function removeBannerBlock(html) {
  let out = String(html || "");
  const marker = 'class="aplr-fxd-bnr"';
  while (out.includes(marker)) {
    const start = out.indexOf("<div", out.indexOf(marker) - 80);
    if (start < 0) break;
    let depth = 0;
    let end = -1;
    for (let i = start; i < out.length; i++) {
      if (out.slice(i, i + 4) === "<div") {
        depth++;
        i += 3;
      } else if (out.slice(i, i + 6) === "</div>") {
        depth--;
        if (depth === 0) {
          end = i + 6;
          break;
        }
        i += 5;
      }
    }
    if (end < 0) break;
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

function fixInnerIframes(html) {
  return String(html || "").replace(/<iframe\b([^>]*)>/gi, (tag, attrs) => {
    let next = attrs.replace(/\bsandbox=['"][^'"]*['"]/gi, "");
    if (!/\ballowfullscreen\b/i.test(next)) next += " allowfullscreen";
    if (!/\ballow=/i.test(next)) {
      next += ' allow="autoplay; encrypted-media; fullscreen; picture-in-picture"';
    }
    return `<iframe${next}>`;
  });
}

function cleanWorldkooraHtml(html) {
  let out = removeBannerBlock(stripScripts(html));
  out = fixInnerIframes(out);
  const headClose = /<\/head>/i;
  if (headClose.test(out)) {
    out = out.replace(headClose, INJECT_HEAD + "</head>");
  } else {
    out = INJECT_HEAD + out;
  }
  return out;
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
        "Cache-Control": "no-cache",
      },
      cf: { cacheTtl: 0 },
      redirect: "follow",
    });

    if (!res.ok) {
      return new Response(`Upstream error ${res.status}`, { status: res.status });
    }

    const html = await res.text();
    return new Response(cleanWorldkooraHtml(html), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-KZ-Proxy": "worldkoora-vip",
      },
    });
  } catch (err) {
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
    return env.ASSETS.fetch(request);
  },
};
