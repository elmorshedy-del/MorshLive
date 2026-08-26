/**
 * Ad-free playback for Arabic AlbaPlayer wrappers (yallacuo / koralive).
 *
 * Those hosts ship aclib.runPop + popunder scripts. The watch page must never
 * iframe them raw. Playback goes through /wk/operator/ with a sandbox that
 * omits allow-popups.
 */

export const OPERATOR_EMBED_PATH = "/wk/operator/";

export const OPERATOR_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-forms";

export const OPERATOR_WRAPPER_HOSTS = Object.freeze(["yallacuo.xyz", "koralive1.cc", "koralive.online"]);

export const OPERATOR_EMBED_AD_HOSTS =
  /cosetengarb|corruptioneasiest|histats|acscdn|aclib|llvpn|widthwidow|doubleclick|googlesyndication|popads|propeller|exoclick|adsterra|mgid|taboola|outbrain|cloudflareinsights|pubads|googletagmanager|google-analytics|imasdk|advertising|\/ads\//i;

function hostnameOf(href) {
  try {
    return new URL(href, "https://korazero.com").hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isOperatorAlbaPlayerUrl(href) {
  const raw = String(href || "").trim();
  if (!raw) return false;
  const host = hostnameOf(raw);
  if (!OPERATOR_WRAPPER_HOSTS.some((ok) => host === ok || host.endsWith(`.${ok}`))) return false;
  return /\/albaplayer\/[a-z0-9-]+\/?/i.test(raw);
}

export function operatorEmbedProxyPath(href, origin = "") {
  if (!isOperatorAlbaPlayerUrl(href)) return "";
  try {
    const target = new URL(href).toString();
    return `${origin}${OPERATOR_EMBED_PATH}?u=${encodeURIComponent(target)}`;
  } catch {
    return "";
  }
}

export function unwrapOperatorEmbedUrl(href) {
  const raw = String(href || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, "https://korazero.com");
    if (!/\/wk\/operator\/?$/i.test(parsed.pathname)) return raw;
    const target = String(parsed.searchParams.get("u") || "").trim();
    return target || raw;
  } catch {
    return raw;
  }
}

function addBaseHref(html, baseUrl) {
  try {
    const base = new URL(baseUrl);
    const href = `${base.origin}${base.pathname}${base.search}`.replace(/"/g, "%22");
    if (/<base\b/i.test(html)) return html;
    if (/<head[^>]*>/i.test(html)) {
      return html.replace(/<head[^>]*>/i, (open) => `${open}<base href="${href}">`);
    }
    return `<base href="${href}">${html}`;
  } catch {
    return html;
  }
}

function withIframeSandbox(html) {
  return String(html || "").replace(/<iframe\b([^>]*)>/gi, (_full, attrs) => {
    let next = attrs;
    if (/\bsandbox\s*=/i.test(next)) {
      next = next.replace(/\bsandbox\s*=\s*(['"]).*?\1/i, `sandbox="${OPERATOR_IFRAME_SANDBOX}"`);
    } else {
      next = `${next} sandbox="${OPERATOR_IFRAME_SANDBOX}"`;
    }
    if (/\ballow-popups/i.test(next)) {
      next = next.replace(/\s*allow-popups(?:-to-escape-sandbox)?/gi, "");
    }
    return `<iframe${next}>`;
  });
}

export function sanitizeOperatorEmbedHtml(html, baseUrl) {
  let out = String(html || "");
  out = out.replace(/<script\b[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/gi, (tag) =>
    OPERATOR_EMBED_AD_HOSTS.test(tag) ? "" : tag,
  );
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => {
    if (OPERATOR_EMBED_AD_HOSTS.test(tag)) return "";
    if (/aclib\.runPop|AplrPopUp|Histats|_Hasync|dataset\.zone/i.test(tag)) return "";
    return tag;
  });
  out = out.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  out = out.replace(/<meta[^>]+http-equiv=["']refresh["'][^>]*>/gi, "");
  out = addBaseHref(out, baseUrl);
  return withIframeSandbox(out);
}
