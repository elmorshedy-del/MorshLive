/* ============================================================================
 * filgoal-highlights-lib.js — Arabic ملخص + أهداف from filgoal.com → YouTube/
 * Dailymotion embeds.
 *
 * Online source: https://www.filgoal.com/videos publishes one clip per event:
 *   • "ملخص فوز/تعادل …" — full match recap (~3–5 min editorial cut)
 *   • "أهداف فوز/تعادل …" — multi-goal reel (only for lower-scoring domestic games;
 *     World Cup fixtures mostly get individual "هدف …" clips instead, which we
 *     skip — same call btolat makes, the ملخص reel already covers every goal).
 * Pages are addressable by numeric id alone (no slug needed) and embed a
 * third-party player (YouTube almost always, occasionally Dailymotion) rather
 * than filgoal's own CDN.
 * ==========================================================================*/
const { extractFilgoalMedia, extractFilgoalTitle, extractFilgoalThumbnail } = require("./lib/filgoal-media");
const { resolveFixtureKey } = require("./lib/highlight-match-lib");

const UA = "Mozilla/5.0 (compatible; MorshLive/1.0)";
const VIDEO_LISTING_URL = "https://www.filgoal.com/videos";

/** Empirically mapped to the FIFA World Cup 2026 window (10 Jun – 19 Jul) on
 * filgoal's sequential video ids, with a few days of buffer either side. */
const FILGOAL_WC_RANGE_START = 50560;
const FILGOAL_WC_RANGE_END = 50800;

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

/** goals = أهداف multi-goal reel; full = ملخص recap. Single هدف clips excluded —
 * same reasoning as btolat: they'd flood the archive and the ملخص already covers them. */
function classifyFilgoalTitle(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/^(?:ملخص|ملخلص)(?:\s|$)/.test(t)) return "full";
  if (/^(?:اهداف|أهداف)(?:\s|$)/.test(t)) return "goals";
  return null;
}

function cleanTeamToken(s) {
  return String(s || "").trim();
}

/** filgoal's grammar is "فوز A على/مع B" / "تعادل A مع/ضد B", not the
 * "مباراة A و B" style btolat/vortex use — needs its own extractor. */
function filgoalTitleTeams(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  const stop = "(?:\\s+\\d+\\s*[-/]\\s*\\d+|\\s+بركلات|\\s*\\(|\\s+-\\s|$)";
  let m = t.match(new RegExp(`^(?:ملخص|ملخلص|اهداف|أهداف)\\s+فوز\\s+(.+?)\\s+(?:على|مع)\\s+(.+?)${stop}`));
  if (m) return { a: cleanTeamToken(m[1]), b: cleanTeamToken(m[2]) };
  m = t.match(new RegExp(`^(?:ملخص|ملخلص|اهداف|أهداف)\\s+تعادل\\s+(.+?)\\s+(?:مع|ضد)\\s+(.+?)${stop}`));
  if (m) return { a: cleanTeamToken(m[1]), b: cleanTeamToken(m[2]) };
  return null;
}

function resolveFilgoalFixtureKey(title, pairKeyFn, matches, arabicTeam) {
  const teams = filgoalTitleTeams(title);
  return resolveFixtureKey(title, teams, matches, {
    pairKeyFn,
    arabicTeam,
    minScore: 1.85,
    minMentionScore: 0.9,
    toleranceDays: 3,
  });
}

/** Fetch one /videos/{id} page → classified candidate, or null when unrelated. */
async function fetchFilgoalCandidate(id) {
  const html = await fetchText(`https://www.filgoal.com/videos/${id}`);
  if (!html || html.length < 500) return null;
  const title = extractFilgoalTitle(html);
  const kind = classifyFilgoalTitle(title);
  if (!kind) return null;
  const media = extractFilgoalMedia(html);
  if (!media) return null;
  return {
    filgoalId: String(id),
    title,
    kind,
    media,
    thumbnail: extractFilgoalThumbnail(html) || "",
  };
}

async function runPool(items, concurrency, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Parse the /videos listing feed for candidate ids (order = editorial recency). */
function parseFilgoalListingIds(html) {
  const ids = [];
  const seen = new Set();
  for (const m of String(html || "").matchAll(/href=["']\/videos\/(\d+)\/[^"']*["']/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    ids.push(m[1]);
  }
  return ids;
}

/** filgoal hides most World Cup ملخص/أهداف clips behind chronological ids rather
 * than a dedicated tournament feed — scan the id range directly (mirrors btolat). */
async function scanFilgoalWorldCupRange(opts = {}) {
  const startId = opts.rangeStart ?? FILGOAL_WC_RANGE_START;
  const endId = opts.rangeEnd ?? FILGOAL_WC_RANGE_END;
  const concurrency = opts.rangeConcurrency ?? 8;
  const ids = [];
  for (let id = startId; id <= endId; id++) ids.push(id);

  const candidates = [];
  await runPool(ids, concurrency, async (id) => {
    try {
      const candidate = await fetchFilgoalCandidate(id);
      if (candidate) candidates.push(candidate);
    } catch { /* skip unreachable id */ }
  });
  return candidates;
}

/** Scrape filgoal → map of pairKey → { goals?, full? }. */
async function scrapeFilgoalHighlights(pairKeyFn, opts = {}) {
  const matches = opts.matches || [];
  const arabicTeam = opts.arabicTeam;
  const concurrency = opts.concurrency ?? 6;

  const seenIds = new Set();
  const candidateIds = [];

  try {
    const html = await fetchText(VIDEO_LISTING_URL);
    for (const id of parseFilgoalListingIds(html)) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      candidateIds.push(id);
    }
  } catch (err) {
    console.warn("filgoal listing fetch failed:", err.message);
  }

  const candidates = [];
  await runPool(candidateIds, concurrency, async (id) => {
    try {
      const candidate = await fetchFilgoalCandidate(id);
      if (candidate) candidates.push(candidate);
    } catch { /* skip unreachable id */ }
  });

  if (opts.scanWorldCupRange) {
    try {
      const rangeCandidates = await scanFilgoalWorldCupRange(opts);
      console.log(`filgoal WC id scan: ${rangeCandidates.length} ملخص/أهداف clips`);
      for (const c of rangeCandidates) {
        if (seenIds.has(c.filgoalId)) continue;
        seenIds.add(c.filgoalId);
        candidates.push(c);
      }
    } catch (err) {
      console.warn("filgoal WC id scan failed:", err.message);
    }
  }

  const out = new Map();
  for (const c of candidates) {
    const key = resolveFilgoalFixtureKey(c.title, pairKeyFn, matches, arabicTeam);
    if (!key) continue;
    if (!out.has(key)) out.set(key, {});
    const bucket = out.get(key);
    if (bucket[c.kind]) continue;
    bucket[c.kind] = {
      videoUrl: c.media.videoUrl,
      title: c.title,
      source: c.media.source,
      embedId: c.media.embedId,
      filgoalId: c.filgoalId,
      thumbnail: c.thumbnail,
      kind: c.kind,
    };
  }
  return out;
}

/** Attach highlights.goals + highlights.full; merge with existing — never drop
 * an already-sourced ملخص/أهداف when the other kind comes from filgoal. */
function applyFilgoalHighlights(match, bucket, normalizeBucket) {
  if (!bucket || (!bucket.goals && !bucket.full)) return false;
  const cleaned = normalizeBucket ? normalizeBucket({ goals: bucket.goals, full: bucket.full }) : bucket;
  if (!cleaned) return false;
  match.highlights = { ...(match.highlights || {}) };
  if (cleaned.goals && !match.highlights.goals) match.highlights.goals = { ...cleaned.goals, kind: "goals" };
  if (cleaned.full && !match.highlights.full) match.highlights.full = { ...cleaned.full, kind: "full" };
  match.highlight = match.highlights.full || match.highlights.goals || match.highlight || null;
  return !!(match.highlights.goals || match.highlights.full);
}

module.exports = {
  VIDEO_LISTING_URL,
  FILGOAL_WC_RANGE_START,
  FILGOAL_WC_RANGE_END,
  classifyFilgoalTitle,
  filgoalTitleTeams,
  resolveFilgoalFixtureKey,
  parseFilgoalListingIds,
  scanFilgoalWorldCupRange,
  scrapeFilgoalHighlights,
  applyFilgoalHighlights,
};
