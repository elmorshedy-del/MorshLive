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
const { resolveFixtureKey, titleTeams: parseTitleTeams, clipRelatesToMatch } = require("./lib/highlight-match-lib");

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

/** goals = أهداف reel; full = ملخص; notable clips exclude single-goal clips. */
function classifyBtolatTitle(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (/^(?:اهداف|أهداف)\s+مباراة/i.test(t)) return "goals";
  if (/^ملخص\s+مباراة/i.test(t)) return "full";
  // User-facing archive should not be flooded with individual goal clips; the
  // goals reel already covers them.
  if (/^(?:هدف|هدفا|هدفي|هدفى)\s+/i.test(t)) return null;
  if (/تصدي|تصد[ىي]|ينقذ|انقاذ|إنقاذ|يحرم/i.test(t)) return "save";
  if (/طرد|بطاقة\s+حمراء|كارت\s+احمر|كارت\s+أحمر|حمراء/i.test(t)) return "card";
  if (/ركلة\s+جزاء|ضربة\s+جزاء|ركلات\s+الترجيح|يهدر|اهدر|أهدر|اضاع|أضاع/i.test(t)) return "penalty";
  if (/فرصة|كاد|محاولة|عارضة|القائم|المرمى|المرمي/i.test(t)) return "chance";
  if (/اصابة|إصابة/i.test(t)) return "injury";
  return null;
}

function isPrimaryKind(kind) {
  return kind === "goals" || kind === "full";
}

function titleTeams(title) {
  return parseTitleTeams(title);
}

function candidatePairKey(video, opts, activeKey) {
  const teams = parseTitleTeams(video.title);
  const contextualOpts = { ...opts, pairKeyFn: opts.pairKeyFn, minScore: 1.85 };
  const key = resolveFixtureKey(video.title, teams, opts.matches, contextualOpts);
  if (key) return key;

  if (isPrimaryKind(video.kind)) {
    return resolveFixtureKey(video.title, null, opts.matches, {
      ...contextualOpts,
      minScore: 0.85,
      minMentionScore: 0.85,
    });
  }

  if (!activeKey) return null;
  const activeMatch = (opts.matches || []).find(
    (m) => (m.key || opts.pairKeyFn?.(m.home, m.away)) === activeKey
  );
  if (!activeMatch) return null;
  return clipRelatesToMatch(video.title, activeMatch, opts.arabicTeam) ? activeKey : null;
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
async function scrapeBtolatHighlights(pairKeyFn, fetchMeta, opts = {}) {
  let feedVideos = [];
  if (opts.useCrawler !== false) {
    try {
      const { crawlBtolatVideos } = await import("./lib/btolat-crawler.mjs");
      const crawled = await crawlBtolatVideos({ maxVideos: opts.maxVideos || 120 });
      feedVideos = crawled.map((v) => ({
        btolatId: v.btolatId,
        title: v.title,
        embedId: v.embedId,
        publishedAt: v.publishedAt,
        kind: classifyBtolatTitle(v.title),
      })).filter((v) => v.kind);
    } catch (err) {
      console.warn("btolat Crawlee fallback to fetch:", err.message);
    }
  }

  const seenIds = new Set();
  const candidates = [];

  if (!feedVideos.length) {
    for (const feed of BTOLAT_VIDEO_FEEDS) {
      const html = await fetchText(feed);
      let activeKey = null;
      for (const v of parseBtolatVideos(html)) {
        const kind = classifyBtolatTitle(v.title);
        if (!kind) continue;
        const video = { ...v, kind };
        const key = candidatePairKey(video, { ...opts, pairKeyFn }, activeKey);
        if (key && isPrimaryKind(kind)) activeKey = key;
        if (seenIds.has(v.btolatId)) continue;
        seenIds.add(v.btolatId);
        candidates.push({ ...video, key, order: candidates.length });
      }
    }
  } else {
    let activeKey = null;
    for (const v of feedVideos) {
      const key = candidatePairKey(v, { ...opts, pairKeyFn }, activeKey);
      if (key && isPrimaryKind(v.kind)) activeKey = key;
      if (seenIds.has(v.btolatId)) continue;
      seenIds.add(v.btolatId);
      candidates.push({ ...v, key, order: candidates.length });
    }
  }

  const out = new Map();
  for (const v of candidates) {
    if (!v.key) continue;
    const embedId = v.embedId || (await fetchBtolatEmbedId(v.btolatId));
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
      publishedAt: v.publishedAt || null,
      order: v.order,
    });

    if (!out.has(v.key)) out.set(v.key, {});
    const bucket = out.get(v.key);
    if (isPrimaryKind(v.kind)) {
      if (!bucket[v.kind]) bucket[v.kind] = clip;
    } else {
      if (!Array.isArray(bucket.clips)) bucket.clips = [];
      if (!bucket.clips.some((c) => c.btolatId === clip.btolatId || c.videoUrl === clip.videoUrl)) {
        bucket.clips.push(clip);
      }
    }
  }

  for (const bucket of out.values()) {
    if (Array.isArray(bucket.clips)) {
      bucket.clips.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
  }
  return out;
}

/** Attach highlights.goals + highlights.full; primary = true ملخص reel or أهداف reel. */
function applyBtolatHighlights(match, bucket, normalizeBucket) {
  if (!bucket || (!bucket.goals && !bucket.full && !bucket.clips?.length)) return false;
  const cleaned = normalizeBucket ? normalizeBucket({ goals: bucket.goals, full: bucket.full }) : bucket;
  if (!cleaned && !bucket.clips?.length) return false;
  match.highlights = {};
  if (cleaned?.goals) match.highlights.goals = { ...cleaned.goals, kind: "goals" };
  if (cleaned?.full) match.highlights.full = { ...cleaned.full, kind: "full" };
  if (bucket.clips?.length) {
    match.clips = bucket.clips
      .filter((c) => c && c.videoUrl && !isPrimaryKind(c.kind))
      .map((c) => ({ ...c, kind: c.kind || "clip" }));
  }
  match.highlight = pickPrimaryFromBucket(match.highlights) || match.highlights.full || match.highlights.goals || null;
  return !!(match.highlight || match.clips?.length);
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
