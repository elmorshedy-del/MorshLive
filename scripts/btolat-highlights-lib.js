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
const { extractBtolatMedia } = require("./lib/btolat-media");
const { resolveFixtureKey, titleTeams: parseTitleTeams, clipRelatesToMatch } = require("./lib/highlight-match-lib");

/** League page + main videos feed (goals clips often only on /videos). */
const BTOLAT_VIDEO_FEEDS = [
  "https://www.btolat.com/league/1056/world-cup",
  "https://www.btolat.com/videos",
];

/** Bounded so one stalled upstream connection can't wedge the whole build;
 * callers already treat "" as a miss. */
const FETCH_TIMEOUT_MS = 15000;

async function fetchText(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
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

async function runIdPool(start, end, concurrency, fn) {
  let next = start;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next <= end) {
      const id = next++;
      await fn(id);
    }
  });
  await Promise.all(workers);
}

/**
 * btolat hides most World Cup ملخص/أهداف clips off the league feed — they live in a
 * dense numeric /video/{id} range during the tournament. Scan it directly.
 */
async function scanBtolatWorldCupRange(pairKeyFn, opts = {}) {
  const startId = opts.rangeStart ?? 93400;
  const endId = opts.rangeEnd ?? 94300;
  const concurrency = opts.rangeConcurrency ?? 10;
  const candidates = [];

  await runIdPool(startId, endId, concurrency, async (id) => {
    const html = await fetchText(`https://www.btolat.com/video/${id}`);
    if (!html || html.length < 500) return;
    const title = (html.match(/<h1[^>]*>([^<]+)</i) || [])[1]?.trim() || "";
    if (!/كأس العالم|world cup/i.test(title)) return;
    const kind = classifyBtolatTitle(title);
    if (!isPrimaryKind(kind)) return;
    const media = extractBtolatMedia(html);
    const teams = parseTitleTeams(title);
    const key = resolveFixtureKey(title, teams, opts.matches, {
      pairKeyFn,
      arabicTeam: opts.arabicTeam,
      minScore: 1.4,
      minMentionScore: 0.8,
      toleranceDays: 5,
    }) || candidatePairKey({ title, kind }, { ...opts, pairKeyFn }, null);
    if (!key) return;
    candidates.push({
      btolatId: String(id),
      title,
      kind,
      media,
      embedId: media?.embedId || null,
      key,
      order: id,
    });
  });

  return candidates;
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

async function fetchBtolatMedia(btolatId) {
  const html = await fetchText(`https://www.btolat.com/video/${btolatId}`);
  return extractBtolatMedia(html);
}

async function fetchBtolatEmbedId(btolatId) {
  const media = await fetchBtolatMedia(btolatId);
  return media?.embedId || null;
}

function clipFromMedia(media, meta) {
  if (!media?.videoUrl) return null;
  return {
    videoUrl: media.videoUrl,
    title: meta.title,
    source: media.source === "twitter" ? "twitter" : "vortex",
    embedId: media.embedId || null,
    tweetId: media.tweetId || null,
    btolatId: meta.btolatId,
    thumbnail: meta.thumbnail || "",
    kind: meta.kind,
  };
}

function clipFromEmbed(embedId, meta) {
  return clipFromMedia(
    { source: "vortex", embedId, videoUrl: `${VORTEX_EMBED_BASE}/${embedId}` },
    meta,
  );
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
      const crawled = await crawlBtolatVideos({ maxVideos: opts.maxVideos || 120, useSitemap: opts.useSitemap });
      feedVideos = crawled.map((v) => ({
        btolatId: v.btolatId,
        title: v.title,
        embedId: v.embedId,
        media: v.media,
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

  if (opts.scanWorldCupRange) {
    try {
      const rangeCandidates = await scanBtolatWorldCupRange(pairKeyFn, opts);
      console.log(`btolat WC ID scan: ${rangeCandidates.length} ملخص/أهداف clips`);
      for (const v of rangeCandidates) {
        if (seenIds.has(v.btolatId)) continue;
        seenIds.add(v.btolatId);
        candidates.push({ ...v, order: v.order ?? candidates.length });
      }
    } catch (err) {
      console.warn("btolat WC ID scan failed:", err.message);
    }
  }

  const out = new Map();
  for (const v of candidates) {
    if (!v.key) continue;
    const media =
      v.media ||
      (v.embedId
        ? { source: "vortex", embedId: v.embedId, videoUrl: `${VORTEX_EMBED_BASE}/${v.embedId}` }
        : await fetchBtolatMedia(v.btolatId));
    if (!media) continue;

    let thumbnail = "";
    if (fetchMeta && media.embedId) {
      try {
        const meta = await fetchMeta(media.embedId);
        thumbnail = meta?.thumbnail || "";
      } catch { /* optional poster */ }
    }

    const clip = clipFromMedia(media, {
      title: v.title,
      btolatId: v.btolatId,
      thumbnail,
      kind: v.kind,
      publishedAt: v.publishedAt || null,
      order: v.order,
    });
    if (!clip) continue;

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

/** Attach highlights.goals + highlights.full; merge with existing — never drop ملخص when adding أهداف. */
function applyBtolatHighlights(match, bucket, normalizeBucket) {
  if (!bucket || (!bucket.goals && !bucket.full && !bucket.clips?.length)) return false;
  const cleaned = normalizeBucket ? normalizeBucket({ goals: bucket.goals, full: bucket.full }) : bucket;
  if (!cleaned && !bucket.clips?.length) return false;
  match.highlights = { ...(match.highlights || {}) };
  // btolat's World Cup pages are entirely X embeds, which render as a tweet card
  // rather than a player — never let one overwrite a better source (a curated
  // vortex embed, say) that an earlier step already attached.
  const { isBetterClip } = require("./vortex-highlights-lib");
  if (cleaned?.goals && isBetterClip(match.highlights.goals, cleaned.goals)) {
    match.highlights.goals = { ...cleaned.goals, kind: "goals" };
  }
  if (cleaned?.full && isBetterClip(match.highlights.full, cleaned.full)) {
    match.highlights.full = { ...cleaned.full, kind: "full" };
  }
  if (bucket.clips?.length) {
    const notable = bucket.clips
      .filter((c) => c && c.videoUrl && !isPrimaryKind(c.kind))
      .map((c) => ({ ...c, kind: c.kind || "clip" }));
    const seen = new Set((match.clips || []).map((c) => c.btolatId || c.videoUrl));
    const merged = [...(match.clips || [])];
    for (const clip of notable) {
      const id = clip.btolatId || clip.videoUrl;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(clip);
    }
    if (merged.length) match.clips = merged;
  }
  match.highlight = pickPrimaryFromBucket(match.highlights) || match.highlights.full || match.highlights.goals || match.highlight || null;
  return !!(match.highlights.goals || match.highlights.full || match.highlight || match.clips?.length);
}

function pickPrimaryFromBucket(highlights) {
  if (highlights?.full) return highlights.full;
  if (highlights?.goals) return highlights.goals;
  return null;
}

module.exports = {
  BTOLAT_VIDEO_FEEDS,
  scrapeBtolatHighlights,
  scanBtolatWorldCupRange,
  applyBtolatHighlights,
  pickPrimaryFromBucket,
  parseBtolatVideos,
  classifyBtolatTitle,
  titleTeams,
};
