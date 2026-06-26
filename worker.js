/**
 * morshlive worker — static assets + worldkoora vip proxy without Yalla Score overlay.
 * /wk/albaplayer/vip1|vip2/ fetches vip.worldkoora.com and strips aplr-fxd-bnr ads.
 */
const WORLDKOORA = "https://vip.worldkoora.com";
const VIP_RE = /^\/wk\/albaplayer\/(vip[12])\/?$/i;

const HIDE_POPUP_STYLE =
  '<style id="kz-no-popup">.aplr-fxd-bnr,#aplr-fixedban{display:none!important;visibility:hidden!important;pointer-events:none!important}</style>';

function stripAdScripts(html) {
  return String(html || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (block) =>
    /cvt-s1\.agl006\.host/i.test(block) ? "" : block
  );
}

function cleanWorldkooraHtml(html) {
  let out = stripAdScripts(html);
  if (out.includes("</head>")) {
    out = out.replace("</head>", HIDE_POPUP_STYLE + "</head>");
  } else {
    out = HIDE_POPUP_STYLE + out;
  }
  return out;
}

async function proxyVip(request, slot) {
  const incoming = new URL(request.url);
  const upstream = new URL(`${WORLDKOORA}/albaplayer/${slot}/`);
  upstream.search = incoming.search;

  const res = await fetch(upstream.toString(), {
    method: "GET",
    headers: {
      "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml",
    },
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
      "Cache-Control": "public, max-age=60",
      "X-KZ-Proxy": "worldkoora-vip",
    },
  });
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
