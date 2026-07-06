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
const { normalizeArabic, levenshtein } = require("./arabic-team-resolver");

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
  const t = String(title || "").replace(/\s+/g, " ").trim();
  const m = /(?:اهداف|أهداف|ملخص)\s+مباراة\s+(.+?)(?:\s*\(|\s+ك[اأ]س)/i.exec(t);
  if (!m) return null;
  const chunk = m[1].replace(/[()]/g, " ").trim();
  const parts = chunk.split(/\s+و\s*/);
  if (parts.length < 2) return null;
  return { a: parts[0].trim(), b: parts[1].trim() };
}

function arabicSimilarity(a, b) {
  const x = normalizeArabic(a);
  const y = normalizeArabic(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) {
    return Math.min(x.length, y.length) / Math.max(x.length, y.length);
  }
  const max = Math.max(x.length, y.length);
  return Math.max(0, 1 - levenshtein(x, y) / max);
}

function uniqueTruthy(items) {
  return [...new Set(items.filter(Boolean))];
}

function teamArabicCandidates(match, side, arabicTeam) {
  const name = match && match[side];
  const ar = arabicTeam ? arabicTeam(name) : "";
  return uniqueTruthy([ar, name]);
}

function sideScore(titleTeam, candidates) {
  return Math.max(0, ...candidates.map((c) => arabicSimilarity(titleTeam, c)));
}

function buildContextualPairKey(teams, opts) {
  const matches = Array.isArray(opts?.matches) ? opts.matches : [];
  if (!matches.length || !opts?.pairKeyFn) return null;

  let best = null;
  for (const m of matches) {
    if (!m?.home || !m?.away) continue;
    const homeNames = teamArabicCandidates(m, "home", opts.arabicTeam);
    const awayNames = teamArabicCandidates(m, "away", opts.arabicTeam);
    const direct =
      sideScore(teams.a, homeNames) + sideScore(teams.b, awayNames);
    const reverse =
      sideScore(teams.a, awayNames) + sideScore(teams.b, homeNames);
    const score = Math.max(direct, reverse);
    if (!best || score > best.score) {
      best = { score, key: m.key || opts.pairKeyFn(m.home, m.away), match: m };
    }
  }

  // Two team names give a max score of 2.0. This accepts typo/hamza variants
  // while still requiring both sides of the title to resemble the same fixture.
  return best && best.score >= 1.45 ? best.key : null;
}

function buildContextualPairKeyFromTitle(title, opts) {
  const matches = Array.isArray(opts?.matches) ? opts.matches : [];
  if (!matches.length || !opts?.pairKeyFn) return null;
  const normTitle = normalizeArabic(title);
  if (!normTitle) return null;

  let best = null;
  for (const m of matches) {
    if (!m?.home || !m?.away) continue;
    const homeScore = Math.max(
      0,
      ...teamArabicCandidates(m, "home", opts.arabicTeam)
        .map((n) => normalizeArabic(n))
        .filter(Boolean)
        .map((n) => (normTitle.includes(n) ? Math.min(1, n.length / 4) : 0))
    );
    const awayScore = Math.max(
      0,
      ...teamArabicCandidates(m, "away", opts.arabicTeam)
        .map((n) => normalizeArabic(n))
        .filter(Boolean)
        .map((n) => (normTitle.includes(n) ? Math.min(1, n.length / 4) : 0))
    );
    const score = homeScore + awayScore;
    if (score > 0 && (!best || score > best.score)) {
      best = { score, key: m.key || opts.pairKeyFn(m.home, m.away) };
    }
  }

  return best && best.score >= 0.9 ? best.key : null;
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
    const key = teams
      ? buildContextualPairKey(teams, { ...opts, pairKeyFn }) || pairKeyFn(teams.a, teams.b)
      : buildContextualPairKeyFromTitle(v.title, { ...opts, pairKeyFn });
    if (!key) continue;
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
    if (isPrimaryKind(v.kind)) {
      if (!bucket[v.kind]) bucket[v.kind] = clip;
    } else {
      if (!Array.isArray(bucket.clips)) bucket.clips = [];
      if (!bucket.clips.some((c) => c.btolatId === clip.btolatId || c.videoUrl === clip.videoUrl)) {
        bucket.clips.push(clip);
      }
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
  buildContextualPairKeyFromTitle,
  titleTeams,
};
