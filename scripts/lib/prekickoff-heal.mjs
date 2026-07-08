/**
 * Pre-kickoff heal — crawl upstream sites, persist rotated embed chains to stream-routes.json.
 * Worker reads the same file at runtime so verify → heal → deploy closes the loop.
 */
import {
  loadStreamRoutes,
  saveStreamRoutes,
  matchRouteKey,
  DEFAULT_ROUTES,
} from "./stream-routes-lib.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const KOORA_CITY = "https://kooora-city.com/";

const KOORA_TEAM_AR = {
  colombia: "كولومبيا",
  switzerland: "سويسرا",
  argentina: "الأرجنتين",
  egypt: "مصر",
  portugal: "البرتغال",
  spain: "إسبانيا",
  brazil: "البرازيل",
  norway: "النرويج",
};

function isDeadText(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return /forbidden|access denied|upstream unavailable|invalid or expired stream token/i.test(t.slice(0, 300));
}

async function fetchText(url, { referer, timeoutMs = 15000 } = {}) {
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

function extractIframes(html, base) {
  const out = [];
  for (const m of String(html || "").matchAll(/<iframe\b[^>]*\bsrc=(["'])([^"']+)\1/gi)) {
    try {
      out.push(new URL(m[2], base).href);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function extractM3u8(html) {
  const out = new Set();
  for (const m of String(html || "").matchAll(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi)) {
    out.add(m[0].replace(/\\u0026/g, "&").replace(/&amp;/g, "&"));
  }
  return [...out];
}

function kooraTeamAr(name) {
  const key = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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

/** Follow iframe chain; return { chain, wrapperUrl, m3u8, hlsOk }. */
export async function crawlEmbedChain(startUrl, referer, { maxDepth = 6 } = {}) {
  const chain = [startUrl];
  let page = await fetchText(startUrl, { referer });
  if (!page.ok) return { chain, wrapperUrl: null, m3u8: null, hlsOk: false, error: page.error || page.status };

  let bestWrapper = null;
  if (!isDeadText(page.text)) bestWrapper = page.url;

  for (const u of extractM3u8(page.text)) {
    const live = await probeM3u8(u, page.url);
    if (live.ok) return { chain, wrapperUrl: bestWrapper || page.url, m3u8: u, hlsOk: true };
  }

  for (let depth = 0; depth < maxDepth; depth++) {
    const iframes = extractIframes(page.text, page.url);
    const next =
      iframes.find((u) => /albaplayer|fluxion|veloqia|yalashot|shootsync|hesgoal|streams\.center|ok\.ru/i.test(u)) ||
      iframes[0];
    if (!next || chain.includes(next)) break;
    chain.push(next);
    page = await fetchText(next, { referer: page.url });
    if (!page.ok) break;
    if (!isDeadText(page.text)) {
      if (!/hls2\.php\?stream=/i.test(page.url) || !isDeadText(page.text)) {
        bestWrapper = page.url;
      }
    }
    for (const u of extractM3u8(page.text)) {
      const live = await probeM3u8(u, page.url);
      if (live.ok) return { chain, wrapperUrl: bestWrapper || page.url, m3u8: u, hlsOk: true };
    }
  }

  return { chain, wrapperUrl: bestWrapper, m3u8: null, hlsOk: false };
}

async function probeM3u8(url, referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "*/*", Referer: referer || url },
    });
    const line = (await res.text()).split("\n")[0]?.trim();
    return { ok: res.ok && line === "#EXTM3U", status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export async function crawlKooraMatchCard(home, away) {
  for (const pageUrl of [KOORA_CITY, `${KOORA_CITY}matches-today/`]) {
    const page = await fetchText(pageUrl, { referer: KOORA_CITY });
    if (!page.ok) continue;
    const card = findKooraCardHref(page.text, home, away);
    if (card) return card;
  }
  return null;
}

export async function crawlNtvRoutes(embedUrl) {
  const start = embedUrl || DEFAULT_ROUTES.slots.ntv.embedUrl;
  const crawled = await crawlEmbedChain(start, "https://ntv.cx/");
  let wrapperUrl = crawled.wrapperUrl;
  if (wrapperUrl && /hls2\.php/i.test(wrapperUrl)) {
    const parent = crawled.chain.find((u) => /ch2\.php|beinmax|hesgoal/i.test(u));
    if (parent) wrapperUrl = parent;
  }
  return {
    embedUrl: start,
    wrapperUrl,
    chain: crawled.chain,
    m3u8: crawled.m3u8,
    hlsOk: crawled.hlsOk,
  };
}

export async function crawlSirTvFromCard(cardUrl) {
  if (!cardUrl) return null;
  const crawled = await crawlEmbedChain(cardUrl, KOORA_CITY);
  const player = crawled.chain.find((u) => /shootsync|sni[a]?er|albaplayer/i.test(u));
  return {
    referer: cardUrl,
    player: player || null,
    chain: crawled.chain,
    wrapperUrl: crawled.wrapperUrl,
    m3u8: crawled.m3u8,
    hlsOk: crawled.hlsOk,
  };
}

/**
 * After verify failures, crawl sources and persist stream-routes.json.
 * Returns { routes, changes[] }.
 */
export async function runPrekickoffHeal(report, match) {
  const routes = loadStreamRoutes();
  const changes = [];
  const key = matchRouteKey(match.home, match.away);

  const failedLayers = Object.entries(report.layers || {})
    .filter(([, v]) => v && !v.ok)
    .map(([k]) => k);

  if (failedLayers.length === 0 && !report.fallback) {
    return { routes, changes, skipped: true };
  }

  console.log("  heal: crawling upstream for", failedLayers.join(", ") || "fallback");

  const card = await crawlKooraMatchCard(match.home, match.away);
  if (card) {
    routes.byMatch[key] = {
      ...(routes.byMatch[key] || {}),
      home: match.home,
      away: match.away,
      kooraCard: card,
      updatedAt: new Date().toISOString(),
    };
    changes.push(`kooraCard:${card}`);

    const kooraChain = await crawlEmbedChain(card, KOORA_CITY);
    if (kooraChain.wrapperUrl) {
      routes.slots.kooraCity.wrapperUrl = kooraChain.wrapperUrl;
      routes.slots.kooraCity.chain = kooraChain.chain;
      routes.byMatch[key].kooraWrapper = kooraChain.wrapperUrl;
      if (kooraChain.m3u8) routes.byMatch[key].kooraM3u8 = kooraChain.m3u8;
      changes.push(`kooraWrapper:${kooraChain.wrapperUrl}`);
    }

    if (failedLayers.includes("sirTv") || failedLayers.includes("main")) {
      const sir = await crawlSirTvFromCard(card);
      if (sir?.player) {
        routes.slots.sirTv.player = sir.player;
        routes.slots.sirTv.referer = sir.referer;
        changes.push(`sirTv.player:${sir.player}`);
      }
    }
  }

  if (failedLayers.includes("ntv") || !routes.slots.ntv.wrapperUrl) {
    const ntv = await crawlNtvRoutes(routes.slots.ntv.embedUrl);
    routes.slots.ntv = { ...routes.slots.ntv, ...ntv };
    if (ntv.wrapperUrl) changes.push(`ntv.wrapper:${ntv.wrapperUrl}`);
    else changes.push("ntv.wrapper:null");
  }

  if (failedLayers.includes("amine") || failedLayers.includes("main")) {
    const amineBase = routes.slots.amine.base;
    for (let serv = 0; serv <= 3; serv++) {
      const url = `${amineBase}?serv=${serv}`;
      const page = await fetchText(url, { referer: amineBase });
      const m3u8 = extractM3u8(page.text);
      if (m3u8[0]) {
        const live = await probeM3u8(m3u8[0], url);
        if (live.ok) {
          routes.slots.amine.defaultServ = serv;
          routes.slots.amine.manifest = m3u8[0];
          changes.push(`amine.serv:${serv}`);
          break;
        }
      }
    }
  }

  const saved = saveStreamRoutes(routes);
  console.log("  heal: saved stream-routes.json —", changes.length ? changes.join("; ") : "no changes");
  return { routes: saved, changes };
}

export { loadStreamRoutes, saveStreamRoutes, matchRouteKey };
