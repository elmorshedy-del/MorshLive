/**
 * Ad-free playback for Arabic AlbaPlayer wrappers (yallacuo / koralive).
 *
 * Those hosts ship a WP chrome page (menus, aclib.runPop) around a real HLS
 * embed (`AlbaPlayerControl(base64Url, 'hls')`, often disguised as .css).
 * Playback goes through /wk/operator/, which extracts that inner stream and
 * serves KoraZero's clean player — never the raw wrapper.
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

export function decodeAlbaPlayerControlSource(b64) {
  try {
    const bin = atob(String(b64 || "").replace(/\s+/g, ""));
    if (!/^https?:\/\//i.test(bin)) return "";
    return bin;
  } catch {
    return "";
  }
}

/**
 * Inner stream the wrapper already knows about. Player type `hls` is HLS even
 * when the URL is disguised as .css / .jpg so hotlinkers miss it.
 */
export function extractAlbaHlsSources(html) {
  const out = [];
  const seen = new Set();
  for (const match of String(html || "").matchAll(
    /AlbaPlayerControl\(\s*'([A-Za-z0-9+/=]+)'\s*,\s*'([^']*)'\s*\)/g,
  )) {
    const source = decodeAlbaPlayerControlSource(match[1]);
    if (!source || seen.has(source)) continue;
    seen.add(source);
    out.push({ source, player: match[2] || "hls" });
  }
  return out;
}

export function operatorHlsRefererForHost(hostname) {
  const host = String(hostname || "")
    .replace(/^www\./, "")
    .toLowerCase();
  if (host.endsWith("dpdns.org") || host.endsWith("koralive1.cc") || host.endsWith("koralive.online")) {
    return { referer: "https://pl.koralive1.cc/", origin: "https://pl.koralive1.cc" };
  }
  if (host.endsWith("yallacuo.xyz")) {
    return { referer: "https://mo.yallacuo.xyz/", origin: "https://mo.yallacuo.xyz" };
  }
  return null;
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

export function sanitizeOperatorEmbedHtml(html, baseUrl) {
  let out = String(html || "");
  out = out.replace(/<script\b[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/gi, (tag) =>
    OPERATOR_EMBED_AD_HOSTS.test(tag) ? "" : tag,
  );
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => {
    if (/AlbaPlayerControl\s*\(/i.test(tag)) return tag;
    if (OPERATOR_EMBED_AD_HOSTS.test(tag)) return "";
    if (/aclib\.runPop|AplrPopUp|Histats|_Hasync|dataset\.zone/i.test(tag)) return "";
    return tag;
  });
  out = out.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  out = out.replace(/<meta[^>]+http-equiv=["']refresh["'][^>]*>/gi, "");
  return addBaseHref(out, baseUrl);
}
