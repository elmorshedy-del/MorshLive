/**
 * HTTP fallback probes when Playwright layers fail — Sir TV, NTV, Amine, Koora City.
 * Does not retune HLS; only checks upstream reachability and live manifests.
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

const SIRTV_PLAYER = "https://we.shootsync.site/albaplayer/sniaer/";
const SIRTV_REFERER = "https://s.sirtv.space/2026/02/ch1.html?m=1";
const AMINE = "https://yallashooot.tv/albaplayer/amine/";
const NTV_EMBED = "https://ntv.cx/embed?t=beinmax1";
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

function extractSirTvLinks(html) {
  const out = new Set();
  for (const m of String(html || "").matchAll(/https?:\/\/s\.sirtv\.space[^\s"'<>]*/gi)) {
    out.add(m[0].replace(/&amp;/g, "&"));
  }
  return [...out];
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

export async function probeSirTvUpstream() {
  const page = await fetchText(SIRTV_PLAYER, { referer: SIRTV_REFERER });
  if (!page.ok) return { ok: false, source: "sirtv-shootsync", status: page.status, error: page.error };
  const urls = extractM3u8(page.text);
  for (const u of urls.slice(0, 4)) {
    const live = await probeM3u8(u, SIRTV_REFERER);
    if (live.ok) return { ok: true, source: "sirtv-shootsync", manifest: u, status: live.status };
  }
  return { ok: false, source: "sirtv-shootsync", status: page.status, manifests: urls.length };
}

export async function probeAmineUpstream() {
  for (let serv = 0; serv <= 3; serv++) {
    const url = `${AMINE}?serv=${serv}`;
    const page = await fetchText(url, { referer: AMINE });
    if (!page.ok) continue;
    const urls = extractM3u8(page.text);
    for (const u of urls.slice(0, 3)) {
      const live = await probeM3u8(u, AMINE);
      if (live.ok) return { ok: true, source: "amine", serv, manifest: u };
    }
  }
  return { ok: false, source: "amine" };
}

export async function probeNtvUpstream() {
  let page = await fetchText(NTV_EMBED, { referer: "https://ntv.cx/" });
  if (!page.ok) return { ok: false, source: "ntv", status: page.status, error: page.error };

  for (let depth = 0; depth < 5; depth++) {
    const urls = extractM3u8(page.text);
    for (const u of urls.slice(0, 4)) {
      const live = await probeM3u8(u, page.url);
      if (live.ok) return { ok: true, source: "ntv", manifest: u, page: page.url };
    }
    const iframes = extractIframeSrc(page.text, page.url);
    if (!iframes.length) break;
    page = await fetchText(iframes[0], { referer: page.url });
    if (!page.ok) break;
  }
  return { ok: false, source: "ntv", embed: page.url };
}

export async function probeKooraCitySirTv(match) {
  const home = (match?.home || "").toLowerCase();
  const away = (match?.away || "").toLowerCase();
  const page = await fetchText(KOORA_CITY, { referer: KOORA_CITY });
  if (!page.ok) return { ok: false, source: "koora-city", status: page.status, error: page.error };

  const sirLinks = extractSirTvLinks(page.text);
  const scored = sirLinks.map((link) => {
    const blob = link.toLowerCase();
    let score = 0;
    if (home && blob.includes(home.slice(0, 4))) score += 2;
    if (away && blob.includes(away.slice(0, 4))) score += 2;
    return { link, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const pick = scored[0]?.link || sirLinks[0];
  if (!pick) return { ok: false, source: "koora-city", sirLinks: 0 };

  const chPage = await fetchText(pick, { referer: KOORA_CITY });
  if (!chPage.ok) return { ok: false, source: "koora-city", sirPage: pick, status: chPage.status };

  const urls = extractM3u8(chPage.text);
  for (const u of urls.slice(0, 4)) {
    const live = await probeM3u8(u, pick);
    if (live.ok) return { ok: true, source: "koora-city", sirPage: pick, manifest: u };
  }
  return { ok: false, source: "koora-city", sirPage: pick, manifests: urls.length };
}

export async function probeKorazeroSlot(base, slot, { serv, ch } = {}) {
  const u = new URL(`/wk/albaplayer/${slot}/`, base.replace(/\/$/, ""));
  if (serv != null) u.searchParams.set("serv", String(serv));
  if (ch) u.searchParams.set("ch", ch);
  const page = await fetchText(u.toString(), { referer: base });
  if (!page.ok) return { ok: false, slot, status: page.status };
  const hasPlayer = /cleanHlsPlayerHtml|video#v|AlbaPlayerControl|<video/i.test(page.text);
  const urls = extractM3u8(page.text);
  return { ok: hasPlayer || urls.length > 0, slot, status: page.status, manifests: urls.length, hasPlayer };
}

export async function runFallbackProbes(base, match) {
  const [sirTv, amine, ntv, koora, kzSir, kzNtv, kzAmine] = await Promise.all([
    probeSirTvUpstream(),
    probeAmineUpstream(),
    probeNtvUpstream(),
    probeKooraCitySirTv(match),
    probeKorazeroSlot(base, "sirtv", { ch: match.channelId }),
    probeKorazeroSlot(base, "ntv", { ch: match.channelId }),
    probeKorazeroSlot(base, "amine", { serv: 0, ch: match.channelId }),
  ]);
  return { sirTv, amine, ntv, kooraCity: koora, korazero: { sirTv: kzSir, ntv: kzNtv, amine: kzAmine } };
}
