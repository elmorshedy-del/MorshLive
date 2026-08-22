/* ============================================================================
 * vortex-highlights-lib.js — Arabic ملخص clips from nvtboo.vortexvisionworks.com
 *
 * Same embed host used by btolat / kawkabnews (e.g. …/embed/4Duh6QTRDC3M6).
 * Discovery: curated embed map → DuckDuckGo site: search → og:title verify.
 * True highlights only — classified by editorial title (ملخص / أهداف), not duration.
 * ==========================================================================*/
const path = require("path");
const { pairKey } = require("./commentators-lib");

const VORTEX_HOST = "nvtboo.vortexvisionworks.com";
const VORTEX_EMBED_BASE = `https://${VORTEX_HOST}/embed`;

const UA = "Mozilla/5.0 (compatible; MorshLive/1.0)";

/** Full-match replays / extended broadcasts — not highlight reels. */
const FULL_MATCH_TITLE_RE = /مباراة\s+كاملة|كامل(?:ة)?\s*(?:للمباراة|المباراة)?|full\s*match|match\s*replay|replay\s*full|إعادة\s*كاملة|90\s*دقيقة|بث\s*كامل|extended\s*highlights?\s*\d{2,3}\s*min/i;

/** Common Arabic transliteration variants (e.g. باراغواي vs باراجواي on vortex titles). */
const TEAM_AR_ALIASES = {
  Paraguay: ["باراجواي"],
};

let _knownEmbeds = null;

function loadKnownEmbeds() {
  if (_knownEmbeds) return _knownEmbeds;
  try {
    _knownEmbeds = require(path.join(__dirname, "../assets/data/vortex-highlights.json"));
  } catch {
    _knownEmbeds = {};
  }
  return _knownEmbeds;
}

function knownEmbedIds(match) {
  const known = loadKnownEmbeds();
  const hit = known[pairKey(match.home, match.away)];
  if (!hit) return {};
  if (typeof hit === "string") return { full: hit };
  return { goals: hit.goals || null, full: hit.full || null };
}

/** Classify btolat/vortex editorial titles — goals reel vs ملخص reel. */
function classifyHighlightTitle(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (!t || FULL_MATCH_TITLE_RE.test(t)) return null;
  if (/^(?:اهداف|أهداف)\s+مباراة/i.test(t)) return "goals";
  if (/^ملخص\s+مباراة/i.test(t)) return "full";
  if (/ملخص/i.test(t) && /مباراة|كأس العالم|world cup|الدوري|أبطال|premier|liga|champions/i.test(t)) return "full";
  if (/(?:اهداف|أهداف)/i.test(t) && /مباراة|كأس العالم|world cup|الدوري|أبطال|premier|liga|champions/i.test(t)) return "goals";
  return null;
}

function isTrueHighlightTitle(title) {
  return classifyHighlightTitle(title) != null;
}

function validateClip(clip) {
  if (!clip || !clip.videoUrl) return null;
  const kind = classifyHighlightTitle(clip.title);
  if (!kind) return null;
  return { ...clip, kind: clip.kind || kind };
}

/** Prefer editorial ملخص reel; fall back to أهداف reel. Both are true highlights. */
function pickPrimaryHighlight(highlights) {
  const goals = highlights?.goals;
  const full = highlights?.full;
  if (full) return full;
  if (goals) return goals;
  return null;
}

function highlightLookupRank(entry) {
  let rank = 0;
  if (entry.kind === "full" || entry.clip === "full") rank += 4;
  else if (entry.kind === "goals" || entry.clip === "goals") rank += 2;
  if (entry.thumbnail) rank += 8;
  if (entry.videoUrl) rank += 1;
  return rank;
}

/** Best poster/embed per match key from highlightsIndex rows. */
function buildHighlightLookup(highlightsIndex) {
  const byKey = new Map();
  for (const entry of highlightsIndex || []) {
    if (!entry?.key || !entry.videoUrl) continue;
    const cur = byKey.get(entry.key);
    if (!cur || highlightLookupRank(entry) > highlightLookupRank(cur)) {
      byKey.set(entry.key, entry);
    }
  }
  return byKey;
}

/** Playback quality ranking, best first. vortex plays inline through our own
 * /replay/embed proxy; youtube/dailymotion are clean third-party players; a
 * twitter clip can only render as an X card carrying the broadcaster's
 * marketing, so it is the last resort. */
const SOURCE_RANK = { vortex: 4, youtube: 3, dailymotion: 3, twitter: 1 };

function sourceRank(clip) {
  if (!clip?.videoUrl) return 0;
  return SOURCE_RANK[clip.source] ?? 2;
}

/** True when `incoming` should replace `existing` — sources are applied in
 * sequence, and without this a later btolat/X clip silently downgrades a
 * curated vortex embed that was already attached. */
function isBetterClip(existing, incoming) {
  if (!incoming?.videoUrl) return false;
  if (!existing?.videoUrl) return true;
  return sourceRank(incoming) > sourceRank(existing);
}

function normalizeHighlightBucket(bucket) {
  if (!bucket) return bucket;
  const out = {};
  if (bucket.goals) {
    const g = validateClip(bucket.goals);
    if (g) out.goals = g;
  }
  if (bucket.full) {
    const f = validateClip(bucket.full);
    if (f) out.full = f;
  }
  // btolat publishes separate اهداف/ملخص article pages that sometimes embed the
  // exact same tweet — same videoUrl for both buckets. Keep ملخص (the canonical
  // archive reel / primary CTA) and drop the redundant أهداف entry.
  if (out.goals && out.full && out.goals.videoUrl === out.full.videoUrl) {
    delete out.goals;
  }
  return Object.keys(out).length ? out : null;
}

function enrichHighlightMeta(meta) {
  if (!meta) return null;
  return validateClip(meta);
}

async function findKnownVortexHighlights(match) {
  const ids = knownEmbedIds(match);
  const out = {};
  if (ids.goals) {
    const meta = enrichHighlightMeta(await fetchVortexEmbedMeta(ids.goals));
    if (meta) out.goals = { ...meta, kind: "goals" };
  }
  if (ids.full) {
    const meta = enrichHighlightMeta(await fetchVortexEmbedMeta(ids.full));
    if (meta) out.full = { ...meta, kind: "full" };
  }
  return out;
}

/** Every caller treats "" as "no result", so a slow or hostile upstream degrades
 * to a miss instead of hanging. Without the timeout a single stalled connection
 * blocks the whole deploy — DuckDuckGo answers 202 and throttles automated
 * queries, which is exactly how this used to wedge. */
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

function extractEmbedIds(html) {
  const ids = new Set();
  const patterns = [
    /nvtboo\.vortexvisionworks\.com\/embed\/([A-Za-z0-9]+)/gi,
    /vortexvisionworks\.com(?:%2F|\/)embed(?:%2F|\/)([A-Za-z0-9]+)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html || ""))) ids.add(m[1]);
  }
  return [...ids];
}

function parseOgTitle(html) {
  const m = (html || "").match(/<meta property="og:title" content="([^"]+)"/i);
  return m ? m[1] : "";
}

function parseOgImage(html) {
  const text = html || "";
  const patterns = [
    /<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i,
    /<meta\s+(?:property|name)=["']twitter:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']twitter:image["']/i,
    /["'](?:poster|thumbnail|thumbnailUrl|preview_image_url)["']\s*:\s*["']([^"']+)["']/i,
    /\b(?:poster|thumbnail|thumbnailUrl)\s*[:=]\s*["']([^"']+)["']/i,
    /(https?:\\?\/\\?\/[^"'\\\s<>]+\/poster\/0\.png[^"'\\\s<>]*)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      return m[1]
        .replace(/\\\//g, "/")
        .replace(/&amp;/g, "&")
        .trim();
    }
  }
  return "";
}

function teamNamesForMatch(name, arabicFor) {
  const primary = arabicFor(name);
  const aliases = TEAM_AR_ALIASES[name] || [];
  return [primary, name, ...aliases].filter(Boolean);
}

function titleMatchesMatch(title, home, away, arabicFor) {
  if (!isTrueHighlightTitle(title)) return false;
  const t = String(title).replace(/\s+/g, " ").trim();
  const homeHit = teamNamesForMatch(home, arabicFor).some((n) => t.includes(n));
  const awayHit = teamNamesForMatch(away, arabicFor).some((n) => t.includes(n));
  return homeHit && awayHit;
}

function vortexQueries(home, away, arabicFor) {
  const homeNames = teamNamesForMatch(home, arabicFor);
  const awayNames = teamNamesForMatch(away, arabicFor);
  const queries = new Set();
  for (const h of homeNames.slice(0, 2)) {
    for (const a of awayNames.slice(0, 2)) {
      queries.add(`site:${VORTEX_HOST} ${h} ${a}`);
    }
  }
  return [...queries];
}

function extractUddgEmbedIds(html) {
  const ids = new Set();
  for (const m of String(html || "").matchAll(/uddg=([^&"]+)/g)) {
    try {
      const url = decodeURIComponent(m[1]);
      const hit = url.match(/embed\/([A-Za-z0-9]+)/i);
      if (hit) ids.add(hit[1]);
    } catch { /* skip bad redirect */ }
  }
  return [...ids];
}

function collectEmbedIdsFromDdgHtml(html) {
  const ids = new Set(extractEmbedIds(html));
  for (const id of extractUddgEmbedIds(html)) ids.add(id);
  return [...ids];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchDdgEmbedIds(query, maxPages = 1) {
  const seen = new Set();
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const url = page === 0
      ? `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${page * 10}`;
    const html = await fetchText(url);
    const ids = collectEmbedIdsFromDdgHtml(html);
    let added = 0;
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      added++;
    }
    if (!added) break;
    await sleep(250);
  }
  return out;
}

const VORTEX_POOL_QUERIES = [
  "site:nvtboo.vortexvisionworks.com ملخص مباراة كأس العالم",
  "site:nvtboo.vortexvisionworks.com أهداف مباراة كأس العالم",
  "site:nvtboo.vortexvisionworks.com ملخص مباراة world cup 2026",
  "site:nvtboo.vortexvisionworks.com embed ملخص كأس العالم",
];

/** Bulk DuckDuckGo discovery — one pass for many fixtures instead of per-match search. */
async function discoverVortexHighlightPool(opts = {}) {
  const queries = opts.queries || VORTEX_POOL_QUERIES;
  const maxPagesPerQuery = opts.maxPagesPerQuery ?? 6;
  const maxClips = opts.maxClips ?? 400;
  const seenIds = new Set();
  const clips = [];

  for (const query of queries) {
    const ids = await searchDdgEmbedIds(query, maxPagesPerQuery);
    for (const id of ids) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const meta = await enrichHighlightMeta(await fetchVortexEmbedMeta(id));
      if (!meta) continue;
      clips.push(meta);
      if (clips.length >= maxClips) return clips;
    }
    await sleep(300);
  }
  return clips;
}

/** Map discovered vortex clips onto ended fixtures by Arabic title matching. */
function mapVortexClipsToMatches(clips, matches, arabicFor, pairKeyFn) {
  const { resolveFixtureKey, titleTeams } = require("./lib/highlight-match-lib");
  const ended = (matches || []).filter((m) => m.status === "ended" || !m.status);
  const out = new Map();

  for (const clip of clips || []) {
    if (!clip?.title || !isTrueHighlightTitle(clip.title)) continue;
    const teams = titleTeams(clip.title);
    const key = resolveFixtureKey(clip.title, teams, ended, {
      pairKeyFn,
      arabicTeam: arabicFor,
      minScore: 1.5,
      minMentionScore: 0.85,
      toleranceDays: 3,
    });
    if (!key) continue;
    const kind = clip.kind || classifyHighlightTitle(clip.title);
    if (kind !== "goals" && kind !== "full") continue;
    if (!out.has(key)) out.set(key, {});
    const bucket = out.get(key);
    if (!bucket[kind]) bucket[kind] = clip;
  }
  return out;
}

async function fetchVortexEmbedMeta(id, opts = {}) {
  const html = await fetchText(`${VORTEX_EMBED_BASE}/${id}`);
  if (!html) return null;
  const title = parseOgTitle(html);
  if (!title) return null;
  const kind = classifyHighlightTitle(title);
  if (!kind && !opts.allowAnyTitle) return null;
  return {
    videoUrl: `${VORTEX_EMBED_BASE}/${id}`,
    title,
    thumbnail: parseOgImage(html) || "",
    source: "vortex",
    embedId: id,
    kind: kind || opts.kind || "clip",
  };
}

async function findKnownVortexHighlight(match) {
  const known = await findKnownVortexHighlights(match);
  return pickPrimaryHighlight(known) || known.full || known.goals || null;
}

function vortexGoalsQueries(home, away, arabicFor) {
  const homeNames = teamNamesForMatch(home, arabicFor);
  const awayNames = teamNamesForMatch(away, arabicFor);
  const queries = new Set();
  for (const h of homeNames.slice(0, 2)) {
    for (const a of awayNames.slice(0, 2)) {
      queries.add(`site:${VORTEX_HOST} اهداف مباراة ${h} ${a}`);
      queries.add(`site:${VORTEX_HOST} أهداف مباراة ${h} ${a}`);
      queries.add(`site:${VORTEX_HOST} ${h} ${a}`);
    }
  }
  return [...queries];
}

function vortexFullQueries(home, away, arabicFor) {
  const homeNames = teamNamesForMatch(home, arabicFor);
  const awayNames = teamNamesForMatch(away, arabicFor);
  const queries = new Set();
  for (const h of homeNames.slice(0, 2)) {
    for (const a of awayNames.slice(0, 2)) {
      queries.add(`site:${VORTEX_HOST} ملخص مباراة ${h} ${a}`);
      queries.add(`site:${VORTEX_HOST} ${h} ${a}`);
    }
  }
  return [...queries];
}

/** Find a full ملخص reel for home vs away. */
async function findVortexFullHighlight(match, arabicFor) {
  if (!match?.home || !match?.away) return null;

  const known = await findKnownVortexHighlights(match);
  if (known.full) {
    const meta = enrichHighlightMeta(await fetchVortexEmbedMeta(known.full));
    if (meta?.kind === "full") return meta;
  }

  const seen = new Set();
  for (const q of vortexFullQueries(match.home, match.away, arabicFor)) {
    const ids = await searchDdgEmbedIds(q);
    for (const id of ids.slice(0, 12)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const meta = enrichHighlightMeta(await fetchVortexEmbedMeta(id));
      if (meta?.kind === "full" && titleMatchesMatch(meta.title, match.home, match.away, arabicFor)) {
        return meta;
      }
    }
  }
  return null;
}

/** Find a goals-only vortex/beIN reel for home vs away. */
async function findVortexGoalsHighlight(match, arabicFor) {
  if (!match?.home || !match?.away) return null;

  const known = await findKnownVortexHighlights(match);
  if (known.goals) {
    const meta = enrichHighlightMeta(await fetchVortexEmbedMeta(known.goals));
    if (meta?.kind === "goals") return meta;
  }

  const seen = new Set();
  for (const q of vortexGoalsQueries(match.home, match.away, arabicFor)) {
    const ids = await searchDdgEmbedIds(q);
    for (const id of ids.slice(0, 12)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const meta = enrichHighlightMeta(await fetchVortexEmbedMeta(id));
      if (meta?.kind === "goals" && titleMatchesMatch(meta.title, match.home, match.away, arabicFor)) {
        return meta;
      }
    }
  }
  return null;
}

/** Find a vortexvisionworks ملخص embed for home vs away. */
async function findVortexHighlight(match, arabicFor) {
  if (!match || !match.home || !match.away) return null;

  const known = await findKnownVortexHighlight(match);
  if (known) return known;

  const seen = new Set();
  for (const q of vortexQueries(match.home, match.away, arabicFor)) {
    const ids = await searchDdgEmbedIds(q);
    for (const id of ids.slice(0, 10)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const meta = await fetchVortexEmbedMeta(id);
      if (meta && titleMatchesMatch(meta.title, match.home, match.away, arabicFor)) {
        return meta;
      }
    }
  }
  return null;
}

module.exports = {
  VORTEX_EMBED_BASE,
  VORTEX_HOST,
  TEAM_AR_ALIASES,
  classifyHighlightTitle,
  isTrueHighlightTitle,
  findVortexHighlight,
  findVortexGoalsHighlight,
  findVortexFullHighlight,
  findKnownVortexHighlight,
  findKnownVortexHighlights,
  titleMatchesMatch,
  fetchVortexEmbedMeta,
  normalizeHighlightBucket,
  isBetterClip,
  sourceRank,
  SOURCE_RANK,
  enrichHighlightMeta,
  pickPrimaryHighlight,
  buildHighlightLookup,
  validateClip,
  extractEmbedIds,
  extractUddgEmbedIds,
  discoverVortexHighlightPool,
  mapVortexClipsToMatches,
  VORTEX_POOL_QUERIES,
};
