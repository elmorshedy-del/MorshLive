/**
 * HTTP fallback probes when Playwright layers fail — Sir TV, NTV, Amine, Koora City.
 * Diagnostics only: does not override Playwright PASS (auditPlayerPlayable is required).
 */
import { DEFAULT_ROUTES, loadStreamRoutes } from "./stream-routes-lib.mjs";
import { crawlKooraMatchCard } from "./prekickoff-heal.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const KOORA_CITY = "https://kooora-city.com/";

async function fetchText(url, { referer, timeoutMs = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,*/*",
        ...(referer ? { Referer: referer } : {}),
      },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, text };
  } catch (e) {
    return { ok: false, status: 0, url, text: "", error: String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function extractM3u8(html) {
  const out = new Set();
  for (const m of String(html || "").matchAll(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi)) {
    out.add(m[0].replace(/\\u0026/g, "&").replace(/&amp;/g, "&"));
  }
  for (const m of String(html || "").matchAll(/["']([^"']+\.m3u8[^"']*)["']/gi)) {
    try {
      const u = m[1].replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
      if (/^https?:\/\//i.test(u)) out.add(u);
    } catch {
      // ignore
    }
  }
  return [...out];
}

function extractIframeSrc(html, base) {
  const out = [];
  for (const m of String(html || "").matchAll(/<iframe\b[^>]*\bsrc=(["'])([^"']+)\1/gi)) {
    try {
      out.push(new URL(m[2], base).href);
    } catch {
      // ignore
    }
  }
  return out;
}

function isDeadShell(text) {
  const t = String(text || "").trim().slice(0, 500);
  return /forbidden|access denied|upstream unavailable|invalid or expired stream token/i.test(t);
}

async function probeM3u8(url, referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "*/*", ...(referer ? { Referer: referer } : {}) },
    });
    const line = (await res.text()).split("\n")[0]?.trim();
    return { ok: res.ok && line === "#EXTM3U", status: res.status, line };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function sirTvFromRoutes(routes) {
  return {
    player: routes?.slots?.sirTv?.player || DEFAULT_ROUTES.slots.sirTv.player,
    referer: routes?.slots?.sirTv?.referer || DEFAULT_ROUTES.slots.sirTv.referer,
  };
}

export async function probeSirTvUpstream(routes = null) {
  const { player, referer } = sirTvFromRoutes(routes || loadStreamRoutes());
  const page = await fetchText(player, { referer });
  if (!page.ok || isDeadShell(page.text)) {
    return { ok: false, source: "sirtv-shootsync", status: page.status, error: page.error };
  }
  const urls = extractM3u8(page.text);
  for (const u of urls.slice(0, 4)) {
    const live = await probeM3u8(u, referer);
    if (live.ok) return { ok: true, source: "sirtv-shootsync", manifest: u, status: live.status };
  }
  return { ok: false, source: "sirtv-shootsync", status: page.status, manifests: urls.length };
}

export async function probeAmineUpstream(routes = null) {
  const base = routes?.slots?.amine?.base || DEFAULT_ROUTES.slots.amine.base;
  const startServ = routes?.slots?.amine?.defaultServ ?? 0;
  for (let i = 0; i <= 3; i++) {
    const serv = (startServ + i) % 4;
    const url = `${base}?serv=${serv}`;
    const page = await fetchText(url, { referer: base });
    if (!page.ok || isDeadShell(page.text)) continue;
    const urls = extractM3u8(page.text);
    for (const u of urls.slice(0, 3)) {
      const live = await probeM3u8(u, base);
      if (live.ok) return { ok: true, source: "amine", serv, manifest: u };
    }
  }
  return { ok: false, source: "amine" };
}

export async function probeNtvUpstream(routes = null) {
  const embedUrl = routes?.slots?.ntv?.embedUrl || DEFAULT_ROUTES.slots.ntv.embedUrl;
  let page = await fetchText(embedUrl, { referer: "https://ntv.cx/" });
  if (!page.ok || isDeadShell(page.text)) {
    return { ok: false, source: "ntv", status: page.status, error: page.error, embed: embedUrl };
  }

  for (let depth = 0; depth < 5; depth++) {
    if (isDeadShell(page.text)) break;
    const urls = extractM3u8(page.text);
    for (const u of urls.slice(0, 4)) {
      const live = await probeM3u8(u, page.url);
      if (live.ok) return { ok: true, source: "ntv", manifest: u, page: page.url };
    }
    const iframes = extractIframeSrc(page.text, page.url);
    const next =
      iframes.find((u) => !/hls2\.php\?stream=/i.test(u)) ||
      iframes.find((u) => /streams\.center|hesgoal|ch2\.php/i.test(u)) ||
      iframes[0];
    if (!next) break;
    page = await fetchText(next, { referer: page.url });
    if (!page.ok) break;
  }
  return { ok: false, source: "ntv", embed: page.url };
}

export async function probeKooraCitySirTv(match, routes = null) {
  const card =
    (match?.home && match?.away && (await crawlKooraMatchCard(match.home, match.away))) ||
    routes?.slots?.kooraCity?.defaultCard ||
    DEFAULT_ROUTES.slots.kooraCity.defaultCard;

  const chPage = await fetchText(card, { referer: KOORA_CITY });
  if (!chPage.ok || isDeadShell(chPage.text)) {
    return { ok: false, source: "koora-city", card, status: chPage.status, error: chPage.error };
  }

  const cSirLinks = [...String(chPage.text || "").matchAll(/https?:\/\/c\.sirtv\.space[^\s"'<>]*/gi)].map(
    (m) => m[0].replace(/&amp;/g, "&")
  );
  const sSirLinks = [...String(chPage.text || "").matchAll(/https?:\/\/s\.sirtv\.space[^\s"'<>]*/gi)].map(
    (m) => m[0].replace(/&amp;/g, "&")
  );
  const chainPages = [card, ...cSirLinks.slice(0, 2), ...sSirLinks.slice(0, 2)];

  for (const pageUrl of chainPages) {
    const page = await fetchText(pageUrl, { referer: KOORA_CITY });
    if (!page.ok || isDeadShell(page.text)) continue;
    const urls = extractM3u8(page.text);
    for (const u of urls.slice(0, 4)) {
      const live = await probeM3u8(u, pageUrl);
      if (live.ok) return { ok: true, source: "koora-city", card, sirPage: pageUrl, manifest: u };
    }
    for (const iframe of extractIframeSrc(page.text, page.url).slice(0, 3)) {
      const nested = await fetchText(iframe, { referer: page.url });
      if (!nested.ok || isDeadShell(nested.text)) continue;
      const nestedUrls = extractM3u8(nested.text);
      for (const u of nestedUrls.slice(0, 3)) {
        const live = await probeM3u8(u, iframe);
        if (live.ok) return { ok: true, source: "koora-city", card, sirPage: iframe, manifest: u };
      }
    }
  }

  return { ok: false, source: "koora-city", card, sirLinks: cSirLinks.length + sSirLinks.length };
}

export async function probeKorazeroSlot(base, slot, { serv, ch } = {}) {
  const u = new URL(`/wk/albaplayer/${slot}/`, base.replace(/\/$/, ""));
  if (serv != null) u.searchParams.set("serv", String(serv));
  if (ch) u.searchParams.set("ch", ch);
  const page = await fetchText(u.toString(), { referer: base });
  if (!page.ok || isDeadShell(page.text)) return { ok: false, slot, status: page.status };
  const hasPlayer = /cleanHlsPlayerHtml|video#v|AlbaPlayerControl|<video/i.test(page.text);
  const urls = extractM3u8(page.text);
  return { ok: hasPlayer && urls.length > 0, slot, status: page.status, manifests: urls.length, hasPlayer };
}

export async function runFallbackProbes(base, match) {
  const routes = loadStreamRoutes();
  const [sirTv, amine, ntv, koora, kzSir, kzNtv, kzAmine, kzKoora] = await Promise.all([
    probeSirTvUpstream(routes),
    probeAmineUpstream(routes),
    probeNtvUpstream(routes),
    probeKooraCitySirTv(match, routes),
    probeKorazeroSlot(base, "sirtv", { ch: match.channelId }),
    probeKorazeroSlot(base, "ntv", { ch: match.channelId }),
    probeKorazeroSlot(base, "amine", { serv: 0, ch: match.channelId }),
    probeKorazeroSlot(base, "kooracity", { ch: match.channelId }),
  ]);
  return {
    sirTv,
    amine,
    ntv,
    kooraCity: koora,
    korazero: { sirTv: kzSir, ntv: kzNtv, amine: kzAmine, kooraCity: kzKoora },
  };
}
