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
        Referer: "https://korazero.com/",
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
  } catch (err) {
    return new Response("Upstream unavailable", { status: 502 });
  }
}

const ROUTING_KEY = "routing";
const ROUTING_JSON = { "Content-Type": "application/json; charset=utf-8" };

const EMPTY_ROUTING = {
  embedBinding: {},
  matchOverrides: {},
  updatedAt: null,
};

async function readRouting(env) {
  if (!env.ROUTING_KV) return { ...EMPTY_ROUTING, source: "static" };
  try {
    const raw = await env.ROUTING_KV.get(ROUTING_KEY);
    if (!raw) return { ...EMPTY_ROUTING, source: "kv-empty" };
    const data = JSON.parse(raw);
    return {
      embedBinding: data.embedBinding || {},
      matchOverrides: data.matchOverrides || {},
      updatedAt: data.updatedAt || null,
      updatedBy: data.updatedBy || null,
      source: "kv",
    };
  } catch {
    return { ...EMPTY_ROUTING, source: "kv-error" };
  }
}

function authAdmin(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;
  const hdr = request.headers.get("Authorization") || "";
  return hdr === `Bearer ${token}`;
}

async function handleRoutingApi(request, env) {
  const url = new URL(request.url);
  const isAdmin = url.pathname === "/api/admin/routing";

  if (request.method === "GET") {
    const data = await readRouting(env);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...ROUTING_JSON, "Cache-Control": "no-store" },
    });
  }

  if (request.method === "PUT" && isAdmin) {
    if (!authAdmin(request, env)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: ROUTING_JSON,
      });
    }
    if (!env.ROUTING_KV) {
      return new Response(JSON.stringify({ error: "ROUTING_KV not configured" }), {
        status: 503,
        headers: ROUTING_JSON,
      });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: ROUTING_JSON,
      });
    }
    const payload = {
      embedBinding: body.embedBinding || {},
      matchOverrides: body.matchOverrides || {},
      updatedAt: new Date().toISOString(),
      updatedBy: "admin",
    };
    await env.ROUTING_KV.put(ROUTING_KEY, JSON.stringify(payload));
    return new Response(JSON.stringify({ ok: true, ...payload }), {
      status: 200,
      headers: ROUTING_JSON,
    });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: ROUTING_JSON,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const vip = url.pathname.match(VIP_RE);
    if (vip && request.method === "GET") {
      return proxyVip(request, vip[1].toLowerCase());
    }
    if (url.pathname === "/api/routing" || url.pathname === "/api/admin/routing") {
      return handleRoutingApi(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
