/**
 * Shared ملخص enrichment for ended fixtures — btolat scrape, vortex bulk pool,
 * per-match vortex search, optional YouTube, merge with previous JSON.
 */
const { attachSummaries } = require("./highlights-lib");
const { scrapeBtolatHighlights, applyBtolatHighlights } = require("./btolat-highlights-lib");
const {
  findVortexHighlight,
  findVortexGoalsHighlight,
  findVortexFullHighlight,
  fetchVortexEmbedMeta,
  normalizeHighlightBucket,
  enrichHighlightMeta,
  pickPrimaryHighlight,
  discoverVortexHighlightPool,
  mapVortexClipsToMatches,
} = require("./vortex-highlights-lib");

function mergeReplayFields(out, prev) {
  if (!prev) return out;
  if (!out.summaryAr && prev.summaryAr) out.summaryAr = prev.summaryAr;
  if (prev.highlights) {
    out.highlights = { ...(out.highlights || {}), ...(prev.highlights || {}) };
    if (!out.highlights.goals && prev.highlights.goals) out.highlights.goals = prev.highlights.goals;
    if (!out.highlights.full && prev.highlights.full) out.highlights.full = prev.highlights.full;
  }
  if (!out.highlight && prev.highlight) out.highlight = prev.highlight;
  if (!(out.clips && out.clips.length) && prev.clips?.length) {
    out.clips = prev.clips;
  }
  if (!out.highlight && out.highlights) {
    out.highlight = pickPrimaryHighlight(out.highlights) || out.highlights.full || out.highlights.goals || null;
  }
  return out;
}

function hasPrimaryHighlight(m) {
  return !!(m.highlight || m.highlights?.goals || m.highlights?.full);
}

function applyVortexBucket(match, bucket, normalizeBucket) {
  if (!bucket || (!bucket.goals && !bucket.full)) return false;
  const cleaned = normalizeBucket ? normalizeBucket(bucket) : bucket;
  if (!cleaned) return false;
  match.highlights = { ...(match.highlights || {}) };
  if (cleaned.goals && !match.highlights.goals) match.highlights.goals = { ...cleaned.goals, kind: "goals" };
  if (cleaned.full && !match.highlights.full) match.highlights.full = { ...cleaned.full, kind: "full" };
  match.highlight = pickPrimaryHighlight(match.highlights) || match.highlights.full || match.highlights.goals || null;
  return !!(match.highlights.goals || match.highlights.full || match.highlight);
}

async function runPool(items, concurrency, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Attach Arabic text summaries + video ملخص/أهداف reels to ended matches.
 * @returns {{ matched: number, total: number }}
 */
async function enrichEndedMatchesWithHighlights(matches, opts = {}) {
  const {
    pairKeyFn,
    arabicTeam,
    previousByKey = new Map(),
    fetchYouTubeHighlight,
    concurrency = 4,
    skipSummaries = false,
    btolatPairKeyFn = pairKeyFn,
  } = opts;

  if (!skipSummaries) attachSummaries(matches);

  for (const m of matches) {
    if (m.status !== "ended") continue;
    const key = pairKeyFn(m.home, m.away);
    const prev = previousByKey.get(key);
    if (prev) mergeReplayFields(m, prev);
  }

  let btolatMap = new Map();
  try {
    btolatMap = await scrapeBtolatHighlights(
      btolatPairKeyFn,
      (id) => fetchVortexEmbedMeta(id, { allowAnyTitle: true }),
      {
        matches,
        arabicTeam,
        maxVideos: 500,
        useSitemap: true,
        scanWorldCupRange: true,
        useCrawler: false,
      },
    );
    const dual = [...btolatMap.values()].filter((b) => b.goals && b.full).length;
    console.log(`btolat highlights: ${btolatMap.size} matches (${dual} with goals+full)`);
  } catch (err) {
    console.warn("btolat highlights scrape failed:", err.message);
  }

  let poolMap = new Map();
  try {
    const clips = await discoverVortexHighlightPool();
    poolMap = mapVortexClipsToMatches(clips, matches, arabicTeam, pairKeyFn);
    console.log(`vortex pool: ${clips.length} clips → ${poolMap.size} fixtures`);
  } catch (err) {
    console.warn("vortex pool discovery failed:", err.message);
  }

  const ended = matches.filter((m) => m.status === "ended");
  const missing = [];

  for (const m of ended) {
    const key = pairKeyFn(m.home, m.away);
    const bt = btolatMap.get(key);
    if (bt) applyBtolatHighlights(m, bt, normalizeHighlightBucket);
    const pool = poolMap.get(key);
    if (pool) applyVortexBucket(m, pool, normalizeHighlightBucket);
    if (!hasPrimaryHighlight(m)) missing.push(m);
  }

  await runPool(missing, concurrency, async (m) => {
    try {
      const vortex = await findVortexHighlight(m, arabicTeam);
      const meta = enrichHighlightMeta(vortex);
      if (meta) {
        if (!m.highlights) m.highlights = {};
        if (meta.kind === "goals" && !m.highlights.goals) m.highlights.goals = meta;
        else if (meta.kind === "full" && !m.highlights.full) m.highlights.full = meta;
        m.highlight = pickPrimaryHighlight(m.highlights) || meta;
        return;
      }
    } catch (err) {
      console.warn(`vortex highlight search failed for ${m.home} vs ${m.away}:`, err.message);
    }

    if (fetchYouTubeHighlight && process.env.YOUTUBE_API_KEY) {
      try {
        const found = await fetchYouTubeHighlight(m);
        if (found) m.highlight = found;
      } catch (err) {
        console.warn(`youtube highlight search failed for ${m.home} vs ${m.away}:`, err.message);
      }
    }
  });

  const missingGoals = ended.filter((m) => !m.highlights?.goals?.videoUrl);
  await runPool(missingGoals, concurrency, async (m) => {
    try {
      const goals = await findVortexGoalsHighlight(m, arabicTeam);
      const meta = enrichHighlightMeta(goals);
      if (meta?.kind === "goals") {
        if (!m.highlights) m.highlights = {};
        m.highlights.goals = meta;
        m.highlight = pickPrimaryHighlight(m.highlights) || m.highlight || meta;
      }
    } catch (err) {
      console.warn(`vortex goals search failed for ${m.home} vs ${m.away}:`, err.message);
    }
  });

  const missingFull = ended.filter((m) => !m.highlights?.full?.videoUrl && !m.highlight?.videoUrl);
  await runPool(missingFull, concurrency, async (m) => {
    try {
      const full = await findVortexFullHighlight(m, arabicTeam);
      const meta = enrichHighlightMeta(full);
      if (meta?.kind === "full") {
        if (!m.highlights) m.highlights = {};
        m.highlights.full = meta;
        m.highlight = pickPrimaryHighlight(m.highlights) || meta;
      }
    } catch (err) {
      console.warn(`vortex full highlight search failed for ${m.home} vs ${m.away}:`, err.message);
    }
  });

  let matched = 0;
  for (const m of ended) {
    if (!m.highlight && m.highlights) {
      m.highlight = pickPrimaryHighlight(m.highlights) || m.highlights.full || m.highlights.goals || null;
    }
    if (hasPrimaryHighlight(m)) matched++;
  }

  return { matched, total: ended.length };
}

module.exports = {
  enrichEndedMatchesWithHighlights,
  mergeReplayFields,
  hasPrimaryHighlight,
};
