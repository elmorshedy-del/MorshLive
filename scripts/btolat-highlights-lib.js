/* ============================================================================
 * btolat-highlights-lib.js — ملخص clips from btolat.com → vortex embed IDs
 * ==========================================================================*/
const BTOLAT_WC_LEAGUE = "https://www.btolat.com/league/1056/world-cup";
const VORTEX_EMBED_BASE = "https://nvtboo.vortexvisionworks.com/embed";
const UA = "Mozilla/5.0 (compatible; MorshLive/1.0)";

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
  });
  if (!res.ok) return "";
  return res.text();
}

function parseBtolatVideos(html) {
  return [...(html || "").matchAll(/href='\/video\/(\d+)'[\s\S]{0,500}?<h3>([^<]+)<\/h3>/g)].map((m) => ({
    btolatId: m[1],
    title: m[2].trim(),
  }));
}

function titleTeams(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  const m = /ملخص مباراة\s+(.+?)\s*\(/.exec(t) || /ملخص مباراة\s+(.+?)\s+كأس/.exec(t);
  if (!m) return null;
  const chunk = m[1].replace(/[()]/g, " ").trim();
  const parts = chunk.split(/\s*و\s*/);
  if (parts.length < 2) return null;
  return { a: parts[0].trim(), b: parts[1].trim() };
}

async function fetchBtolatEmbedId(btolatId) {
  const html = await fetchText(`https://www.btolat.com/video/${btolatId}`);
  const m = (html || "").match(/vortexvisionworks\.com\/embed\/([A-Za-z0-9]+)/i);
  return m ? m[1] : null;
}

/** Scrape btolat World Cup video list → map of pairKey → highlight meta. */
async function scrapeBtolatHighlights(pairKeyFn) {
  const html = await fetchText(BTOLAT_WC_LEAGUE);
  const videos = parseBtolatVideos(html).filter((v) => /^ملخص مباراة/.test(v.title));
  const out = new Map();
  for (const v of videos) {
    const teams = titleTeams(v.title);
    if (!teams) continue;
    const embedId = await fetchBtolatEmbedId(v.btolatId);
    if (!embedId) continue;
    const key = pairKeyFn(teams.a, teams.b);
    out.set(key, {
      videoUrl: `${VORTEX_EMBED_BASE}/${embedId}`,
      title: v.title,
      source: "vortex",
      embedId,
      btolatId: v.btolatId,
    });
  }
  return out;
}

module.exports = {
  scrapeBtolatHighlights,
  parseBtolatVideos,
  titleTeams,
};
