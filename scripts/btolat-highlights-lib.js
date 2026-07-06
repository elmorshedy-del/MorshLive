/* ============================================================================
 * btolat-highlights-lib.js — Arabic ملخص + أهداف from btolat.com → vortex embeds
 *
 * Online source: https://www.btolat.com publishes separate clips per match:
 *   • "اهداف مباراة …" — goals-only (~3–4 min, approximate)
 *   • "ملخص مباراة …" — full highlights (~10 min, approximate)
 * Same vortex host as kawkabnews (nvtboo.vortexvisionworks.com).
 * ==========================================================================*/
const VORTEX_EMBED_BASE = "https://nvtboo.vortexvisionworks.com/embed";
const UA = "Mozilla/5.0 (compatible; MorshLive/1.0)";

/** League page + main videos feed (goals clips often only on /videos). */
const BTOLAT_VIDEO_FEEDS = [
  "https://www.btolat.com/league/1056/world-cup",
  "https://www.btolat.com/videos",
];

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
  });
  if (!res.ok) return "";
  return res.text();
}

function parseBtolatVideos(html) {
  return [...(html || "").matchAll(/href=['"]\/video\/(\d+)['"][\s\S]{0,500}?<h3>([^<]+)<\/h3>/g)].map((m) => ({
    btolatId: m[1],
    title: m[2].trim(),
  }));
}

/** goals = أهداف only clip; full = ملخص highlights clip */
function classifyBtolatTitle(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (/^(?:اهداف|أهداف)\s+مباراة/i.test(t)) return "goals";
  if (/^ملخص\s+مباراة/i.test(t)) return "full";
  return null;
}

function titleTeams(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  const m = /(?:اهداف|أهداف|ملخص)\s+مباراة\s+(.+?)(?:\s*\(|\s+كأس)/i.exec(t);
  if (!m) return null;
  const chunk = m[1].replace(/[()]/g, " ").trim();
  const parts = chunk.split(/\s+و\s*/);
  if (parts.length < 2) return null;
  return { a: parts[0].trim(), b: parts[1].trim() };
}

async function fetchBtolatEmbedId(btolatId) {
  const html = await fetchText(`https://www.btolat.com/video/${btolatId}`);
  const m = (html || "").match(/vortexvisionworks\.com\/embed\/([A-Za-z0-9]+)/i);
  return m ? m[1] : null;
}

function clipFromEmbed(embedId, meta) {
  return {
    videoUrl: `${VORTEX_EMBED_BASE}/${embedId}`,
    title: meta.title,
    source: "vortex",
    embedId,
    btolatId: meta.btolatId,
    thumbnail: meta.thumbnail || "",
    kind: meta.kind,
  };
}

/**
 * Scrape btolat World Cup feeds → map of pairKey → { goals?, full? }.
 * Approximate durations are editorial on btolat; we classify by title only.
 */
async function scrapeBtolatHighlights(pairKeyFn, fetchMeta) {
  const seenIds = new Set();
  const candidates = [];
  for (const feed of BTOLAT_VIDEO_FEEDS) {
    const html = await fetchText(feed);
    for (const v of parseBtolatVideos(html)) {
      if (seenIds.has(v.btolatId)) continue;
      const kind = classifyBtolatTitle(v.title);
      if (!kind) continue;
      seenIds.add(v.btolatId);
      candidates.push({ ...v, kind });
    }
  }

  const out = new Map();
  for (const v of candidates) {
    const teams = titleTeams(v.title);
    if (!teams) continue;
    const key = pairKeyFn(teams.a, teams.b);
    const embedId = await fetchBtolatEmbedId(v.btolatId);
    if (!embedId) continue;

    let thumbnail = "";
    if (fetchMeta) {
      try {
        const meta = await fetchMeta(embedId);
        thumbnail = meta?.thumbnail || "";
      } catch { /* optional poster */ }
    }

    const clip = clipFromEmbed(embedId, {
      title: v.title,
      btolatId: v.btolatId,
      thumbnail,
      kind: v.kind,
    });

    if (!out.has(key)) out.set(key, {});
    const bucket = out.get(key);
    if (!bucket[v.kind]) bucket[v.kind] = clip;
  }
  return out;
}

/** Attach highlights.goals + highlights.full; primary = true ملخص reel or أهداف reel. */
function applyBtolatHighlights(match, bucket, normalizeBucket) {
  if (!bucket || (!bucket.goals && !bucket.full)) return false;
  const cleaned = normalizeBucket ? normalizeBucket({ ...bucket }) : bucket;
  if (!cleaned || (!cleaned.goals && !cleaned.full)) return false;
  match.highlights = {};
  if (cleaned.goals) match.highlights.goals = { ...cleaned.goals, kind: "goals" };
  if (cleaned.full) match.highlights.full = { ...cleaned.full, kind: "full" };
  match.highlight = pickPrimaryFromBucket(match.highlights) || match.highlights.full || match.highlights.goals;
  return !!match.highlight;
}

function pickPrimaryFromBucket(highlights) {
  if (highlights?.full) return highlights.full;
  if (highlights?.goals) return highlights.goals;
  return null;
}

module.exports = {
  BTOLAT_VIDEO_FEEDS,
  scrapeBtolatHighlights,
  applyBtolatHighlights,
  pickPrimaryFromBucket,
  parseBtolatVideos,
  classifyBtolatTitle,
  titleTeams,
};
