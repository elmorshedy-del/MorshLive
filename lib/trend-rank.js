/**
 * Pure X-trends ranking — the "what is trending right now" logic for the home
 * ترند X rail, shared by the worker and tests.
 *
 * Design (Hacker-News-style time-gravity ranking):
 *
 *   score = weightedEngagement × mediaBoost / (ageHours + AGE_OFFSET)^gravity
 *
 * - weightedEngagement: likes + 2×retweets (a retweet actively spreads the
 *   post, so it is a stronger trend signal than a like); falls back to the
 *   precomputed `engagement` field when like/retweet counts are absent.
 * - gravity divides by a power of age, so a fresh post with moderate traction
 *   outranks an old post with a bigger absolute count — velocity is implicit,
 *   no separate likes-per-hour term needed. AGE_OFFSET keeps brand-new posts
 *   with a handful of likes from dividing by ~zero and shooting to the top.
 * - videos get a mild boost: they are the format that actually trends on
 *   football X, and the rail plays them inline.
 *
 * Selection additionally enforces:
 * - a freshness pool (last 3 days, widening to a 7-day ceiling when short —
 *   never past it; stale filler reads as broken, see meme-select.js),
 * - content dedupe by first media URL (meme accounts repost the same clip),
 * - deterministic order: score desc, then newer first, then id.
 *
 * Authors are deliberately NOT limited: the rail optimizes for the strongest
 * memes, whoever posted them.
 */

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

export const TREND_DEFAULTS = {
  gravity: 1.35, // age exponent: how fast heat fades (HN uses 1.8 hourly; daily rail is gentler)
  ageOffsetHours: 2, // flattens the curve for <2h-old posts
  retweetWeight: 2, // retweets count double
  videoBoost: 1.15,
  poolWindowsDays: [3, 7], // prefer 3 days; widen to 7 only when short
  limit: 20,
};

export function memePostedMs(meme) {
  const t = Date.parse(meme?.postedAt || "");
  return Number.isNaN(t) ? 0 : t;
}

export function weightedEngagement(meme, opts = {}) {
  const rtWeight = opts.retweetWeight ?? TREND_DEFAULTS.retweetWeight;
  const likes = Number(meme?.likes) || 0;
  const retweets = Number(meme?.retweets) || 0;
  if (likes || retweets) return likes + rtWeight * retweets;
  return Number(meme?.engagement) || 0;
}

function hasVideo(meme) {
  return (meme?.media || []).some((m) => m && (m.type === "video" || m.type === "animated_gif"));
}

export function trendScore(meme, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const gravity = opts.gravity ?? TREND_DEFAULTS.gravity;
  const ageOffset = opts.ageOffsetHours ?? TREND_DEFAULTS.ageOffsetHours;
  const videoBoost = opts.videoBoost ?? TREND_DEFAULTS.videoBoost;
  const posted = memePostedMs(meme);
  if (!posted) return 0;
  const ageHours = Math.max(0, (nowMs - posted) / HOUR_MS);
  const base = weightedEngagement(meme, opts) * (hasVideo(meme) ? videoBoost : 1);
  return base / (ageHours + ageOffset) ** gravity;
}

/** First media URL, normalized — the identity of the actual clip/image. */
function contentKey(meme) {
  const item = (meme?.media || [])[0];
  const url = String(item?.url || item?.previewUrl || "")
    .trim()
    .toLowerCase();
  return url || null;
}

/** Drop reposts of the same media, keeping the higher-scoring entry. */
export function dedupeByContent(scored) {
  const byKey = new Map();
  const out = [];
  for (const entry of scored) {
    const key = contentKey(entry.meme);
    if (!key) {
      out.push(entry);
      continue;
    }
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, entry);
      out.push(entry);
    } else if (entry.score > prev.score) {
      out[out.indexOf(prev)] = entry;
      byKey.set(key, entry);
    }
  }
  return out;
}

/**
 * Rank a meme pool into the home trends rail: freshness pool → score →
 * repost dedupe → top `limit`, hottest first. Purely merit-ranked: authors
 * are never limited — the strongest memes take the rail regardless of who
 * posted them (only literal reposts of the same media are collapsed).
 */
export function rankTrendingMemes(memes, opts = {}) {
  const limit = opts.limit ?? TREND_DEFAULTS.limit;
  const nowMs = opts.nowMs ?? Date.now();
  const windows = opts.poolDays ? [opts.poolDays] : opts.poolWindowsDays || TREND_DEFAULTS.poolWindowsDays;
  const list = memes || [];

  // Freshness pool: prefer the tightest window; widen only up to the ceiling.
  let pool = [];
  for (const days of windows) {
    pool = list.filter((m) => memePostedMs(m) >= nowMs - days * DAY_MS);
    if (pool.length >= limit) break;
  }

  const scored = pool
    .map((meme) => ({ meme, score: trendScore(meme, { ...opts, nowMs }) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const dt = memePostedMs(b.meme) - memePostedMs(a.meme);
      if (dt) return dt;
      return String(a.meme.tweetId || a.meme.url || "").localeCompare(
        String(b.meme.tweetId || b.meme.url || ""),
      );
    });

  return dedupeByContent(scored)
    .slice(0, limit)
    .map(({ meme, score }, i) => ({
      ...meme,
      trendScore: Math.round(score * 1000) / 1000,
      trendRank: i + 1,
    }));
}
