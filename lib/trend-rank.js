/**
 * Pure X-trends selection — the logic for the home ترند X rail, shared by the
 * worker and tests.
 *
 * Model: a curated timeline. The rail reads like a Twitter/Facebook scroll —
 * newest posts first, because those are what track the current news cycle —
 * but only each day's BEST posts get in:
 *
 * - quality = likes + 2×retweets (a retweet actively spreads the post, so it
 *   is a stronger signal than a like; falls back to the precomputed
 *   `engagement` field), with a mild boost for video — the format that
 *   actually trends on football X, and the rail plays it inline.
 * - membership is decided per local day (Arabia tz), round-robin from the
 *   newest day: each day contributes its top posts until the rail is full.
 *   A day is only judged against itself, so a huge match yesterday can never
 *   crowd today's events out of the rail — and a quiet day still shows its
 *   best few instead of being filtered to nothing.
 * - the pool is the last 3 days, widening to a 7-day ceiling when short —
 *   never past it; stale filler reads as broken.
 * - reposts of the same media collapse to the higher-quality entry.
 * - display order is strictly newest-first (ties: higher quality, then id),
 *   deterministic.
 *
 * Authors are deliberately NOT limited: the rail carries the strongest posts,
 * whoever posted them.
 */

import { memeDayKey } from "./meme-threshold.js";

const DAY_MS = 86400000;

export const TREND_DEFAULTS = {
  retweetWeight: 2, // retweets count double
  videoBoost: 1.15,
  dayTzOffsetHours: 3, // Arabia local day — same convention as the rest of the site
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

/** Quality of a post, independent of when it was posted. */
export function qualityScore(meme, opts = {}) {
  const videoBoost = opts.videoBoost ?? TREND_DEFAULTS.videoBoost;
  return weightedEngagement(meme, opts) * (hasVideo(meme) ? videoBoost : 1);
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

function compareQualityDesc(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const dt = memePostedMs(b.meme) - memePostedMs(a.meme);
  if (dt) return dt;
  return String(a.meme.tweetId || a.meme.url || "").localeCompare(String(b.meme.tweetId || b.meme.url || ""));
}

function compareNewestFirst(a, b) {
  const dt = memePostedMs(b.meme) - memePostedMs(a.meme);
  if (dt) return dt;
  if (b.score !== a.score) return b.score - a.score;
  return String(a.meme.tweetId || a.meme.url || "").localeCompare(String(b.meme.tweetId || b.meme.url || ""));
}

/**
 * Select the rail: freshness pool → per-day best (round-robin from the newest
 * day) → newest-first feed order.
 */
export function rankTrendingMemes(memes, opts = {}) {
  const limit = opts.limit ?? TREND_DEFAULTS.limit;
  const nowMs = opts.nowMs ?? Date.now();
  const tz = opts.dayTzOffsetHours ?? TREND_DEFAULTS.dayTzOffsetHours;
  const windows = opts.poolDays ? [opts.poolDays] : opts.poolWindowsDays || TREND_DEFAULTS.poolWindowsDays;
  const list = memes || [];

  // Freshness pool: prefer the tightest window; widen only up to the ceiling.
  let pool = [];
  for (const days of windows) {
    pool = list.filter((m) => memePostedMs(m) >= nowMs - days * DAY_MS);
    if (pool.length >= limit) break;
  }

  const scored = dedupeByContent(
    pool.map((meme) => ({ meme, score: qualityScore(meme, opts) })).sort(compareQualityDesc),
  );

  // Bucket by local day, each bucket already quality-sorted.
  const byDay = new Map();
  for (const entry of scored) {
    const key = memeDayKey(entry.meme.postedAt, tz);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(entry);
  }
  const days = [...byDay.keys()].sort().reverse(); // newest day first

  // Round-robin across days: every day gets its best post before any day gets
  // its second, so no single day can crowd the others out — and the rail still
  // fills to `limit` when one day holds most of the pool.
  const picked = [];
  for (let round = 0; picked.length < limit; round++) {
    let added = false;
    for (const day of days) {
      const bucket = byDay.get(day);
      if (round < bucket.length && picked.length < limit) {
        picked.push(bucket[round]);
        added = true;
      }
    }
    if (!added) break;
  }

  return picked.sort(compareNewestFirst).map(({ meme, score }, i) => ({
    ...meme,
    trendScore: Math.round(score * 1000) / 1000,
    trendRank: i + 1,
  }));
}
