/* ============================================================================
 * vortex-highlights-lib.js — Arabic ملخص clips from nvtboo.vortexvisionworks.com
 *
 * Same embed host used by btolat / kawkabnews (e.g. …/embed/4Duh6QTRDC3M6).
 * Discovery: curated embed map → DuckDuckGo site: search → og:title verify.
 * ==========================================================================*/
const path = require("path");
const { pairKey } = require("./commentators-lib");

const VORTEX_HOST = "nvtboo.vortexvisionworks.com";
const VORTEX_EMBED_BASE = `https://${VORTEX_HOST}/embed`;

const UA = "Mozilla/5.0 (compatible; MorshLive/1.0)";

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

async function findKnownVortexHighlights(match) {
  const ids = knownEmbedIds(match);
  const out = {};
  if (ids.goals) {
    const meta = await fetchVortexEmbedMeta(ids.goals);
    if (meta) out.goals = meta;
  }
  if (ids.full) {
    const meta = await fetchVortexEmbedMeta(ids.full);
    if (meta) out.full = meta;
  }
  return out;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
  });
  if (!res.ok) return "";
  return res.text();
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
  const m = (html || "").match(/<meta property="og:image" content="([^"]+)"/i);
  return m ? m[1] : "";
}

/** Reject full-match uploads mislabeled as ملخص (~20+ min). */
const MAX_HIGHLIGHT_SECONDS = 20 * 60;

function absUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("http")) return u;
  return u;
}

function extractHlsUrlFromEmbed(html) {
  const m = (html || "").match(/src:\{hls:'([^']+)'/);
  return m ? absUrl(m[1]) : "";
}

function sumExtinfDuration(playlistText) {
  let total = 0;
  for (const line of String(playlistText || "").split("\n")) {
    const m = line.match(/^#EXTINF:([0-9.]+)/);
    if (m) total += parseFloat(m[1]) || 0;
  }
  return total;
}

async function fetchHlsDurationSeconds(hlsUrl) {
  const masterUrl = absUrl(hlsUrl);
  if (!masterUrl) return null;
  try {
    const master = await fetchText(masterUrl);
    if (!master) return null;
    const variantLine = master.split("\n").find((l) => l.trim() && !l.startsWith("#"));
    if (!variantLine) return sumExtinfDuration(master) || null;
    const base = masterUrl.replace(/[^/]+$/, "");
    const variantUrl = absUrl(variantLine.trim().startsWith("http") ? variantLine.trim() : base + variantLine.trim());
    const playlist = await fetchText(variantUrl);
    const secs = sumExtinfDuration(playlist);
    return secs > 0 ? Math.round(secs) : null;
  } catch {
    return null;
  }
}

async function fetchEmbedDurationSeconds(embedId) {
  if (!embedId) return null;
  const html = await fetchText(`${VORTEX_EMBED_BASE}/${embedId}`);
  const hls = extractHlsUrlFromEmbed(html);
  if (!hls) return null;
  return fetchHlsDurationSeconds(hls);
}

function clipTooLong(clip) {
  const d = clip && clip.durationSeconds;
  return typeof d === "number" && d > MAX_HIGHLIGHT_SECONDS;
}

/** Prefer full ملخص when ≤20m; otherwise goals; never surface 20m+ full as primary. */
function pickPrimaryHighlight(highlights) {
  const goals = highlights?.goals;
  const full = highlights?.full;
  if (full && !clipTooLong(full)) return full;
  if (goals && !clipTooLong(goals)) return goals;
  if (goals) return goals;
  if (full) return full;
  return null;
}

async function enrichClipDuration(clip) {
  if (!clip || clip.durationSeconds != null) return clip;
  const id = clip.embedId || (String(clip.videoUrl || "").match(/\/embed\/([A-Za-z0-9]+)/) || [])[1];
  if (!id) return clip;
  const durationSeconds = await fetchEmbedDurationSeconds(id);
  if (durationSeconds == null) return clip;
  return { ...clip, durationSeconds };
}

/** Drop or demote clips over MAX_HIGHLIGHT_SECONDS; set match.highlight. */
async function normalizeHighlightBucket(bucket) {
  if (!bucket) return bucket;
  const out = { ...bucket };
  if (out.goals) out.goals = await enrichClipDuration(out.goals);
  if (out.full) out.full = await enrichClipDuration(out.full);
  if (out.full && clipTooLong(out.full)) delete out.full;
  if (out.goals && clipTooLong(out.goals) && out.full) delete out.goals;
  return out;
}

async function enrichHighlightMeta(meta) {
  if (!meta) return meta;
  const enriched = await enrichClipDuration(meta);
  if (clipTooLong(enriched)) return null;
  return enriched;
}

function teamNamesForMatch(name, arabicFor) {
  const primary = arabicFor(name);
  const aliases = TEAM_AR_ALIASES[name] || [];
  return [primary, name, ...aliases].filter(Boolean);
}

function titleMatchesMatch(title, home, away, arabicFor) {
  if (!title || !/ملخص|اهداف/i.test(title)) return false;
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

async function searchDdgEmbedIds(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url);
  return extractEmbedIds(html);
}

async function fetchVortexEmbedMeta(id) {
  const html = await fetchText(`${VORTEX_EMBED_BASE}/${id}`);
  if (!html) return null;
  const title = parseOgTitle(html);
  if (!title) return null;
  return {
    videoUrl: `${VORTEX_EMBED_BASE}/${id}`,
    title,
    thumbnail: parseOgImage(html) || "",
    source: "vortex",
    embedId: id,
  };
}

async function findKnownVortexHighlight(match) {
  const known = await findKnownVortexHighlights(match);
  return known.full || known.goals || null;
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
  MAX_HIGHLIGHT_SECONDS,
  findVortexHighlight,
  findKnownVortexHighlight,
  findKnownVortexHighlights,
  titleMatchesMatch,
  fetchVortexEmbedMeta,
  fetchEmbedDurationSeconds,
  enrichClipDuration,
  enrichHighlightMeta,
  normalizeHighlightBucket,
  pickPrimaryHighlight,
  clipTooLong,
  extractEmbedIds,
};
