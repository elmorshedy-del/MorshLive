/**
 * Pure X-trends selection — the logic for the home ترند X rail, shared by the
 * worker and tests.
 *
 * Model: a refined timeline. The source accounts post multiple times every
 * day, so the rail reads like a Twitter/Facebook scroll — newest posts first,
 * tracking the current news cycle — and instead of keeping only each day's
 * few "best", it KEEPS each day's posts and only filters the garbage out:
 *
 * - quality = likes + 2×retweets (a retweet actively spreads the post, so it
 *   is a stronger signal than a like; falls back to the precomputed
 *   `engagement` field), with a mild boost for video — the format that
 *   actually trends on football X, and the rail plays it inline.
 * - garbage filter, per local day (Arabia tz): drop only the clear duds —
 *   posts below `garbageFraction` × that day's MEDIAN quality (plus an
 *   optional absolute floor). Judging each day against its own median keeps
 *   the filter gentle: a quiet day still shows its posts, a busy day drops
 *   only its underperformers. Nothing is capped to a tiny "top" set.
 * - the pool is the last 3 days, widening to a 7-day ceiling when short —
 *   never past it; stale filler reads as broken. If the whole window is empty
 *   (stale ingest), fall back to the newest content that exists.
 * - reposts of the same media collapse to the higher-quality entry.
 * - display order is strictly newest-first (ties: higher quality, then id),
 *   deterministic; the rail is widened to `limit` (30) posts.
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
  garbageFraction: 0.2, // drop posts below 20% of their day's median quality
  minEngagementFloor: 0, // optional hard floor; 0 = rely purely on the relative filter
  limit: 30, // widened scroll
};

/** Median of a numeric array (0 for empty). */
export function median(nums) {
  if (!nums?.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function memePostedMs(meme) {
  const t = Date.parse(meme?.postedAt || "");
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Clamp a paid-API fetch window start to at most `maxDays` back. The rail only
 * ever displays recent days, so re-reading a whole tournament of posts on
 * every scan just burns the X API read quota for nothing.
 */
export function clampSinceUtc(sinceUtc, nowMs = Date.now(), maxDays = 7) {
  const floor = nowMs - maxDays * DAY_MS;
  const t = Date.parse(sinceUtc || "");
  const start = Number.isNaN(t) ? floor : Math.max(t, floor);
  return new Date(start).toISOString();
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
 * Select the rail: freshness pool → per-day garbage filter → newest-first feed.
 */
export function rankTrendingMemes(memes, opts = {}) {
  const limit = opts.limit ?? TREND_DEFAULTS.limit;
  const nowMs = opts.nowMs ?? Date.now();
  const tz = opts.dayTzOffsetHours ?? TREND_DEFAULTS.dayTzOffsetHours;
  const garbageFraction = opts.garbageFraction ?? TREND_DEFAULTS.garbageFraction;
  const minFloor = opts.minEngagementFloor ?? TREND_DEFAULTS.minEngagementFloor;
  const windows = opts.poolDays ? [opts.poolDays] : opts.poolWindowsDays || TREND_DEFAULTS.poolWindowsDays;
  const list = memes || [];

  // Freshness pool: prefer the tightest window; widen only up to the ceiling.
  let pool = [];
  for (const days of windows) {
    pool = list.filter((m) => memePostedMs(m) >= nowMs - days * DAY_MS);
    if (pool.length >= limit) break;
  }
  // Last resort: when the ingest is stale and the whole window is empty, show
  // the newest content that exists rather than blanking the rail — a homepage
  // section that silently disappears reads as broken.
  if (!pool.length) pool = list.filter((m) => memePostedMs(m) > 0);

  const scored = dedupeByContent(
    pool.map((meme) => ({ meme, score: qualityScore(meme, opts) })).sort(compareQualityDesc),
  );

  // Per-day garbage filter: drop posts below garbageFraction × that day's
  // median quality (and below the optional absolute floor). Everything else
  // survives — a day is never trimmed to a "top few".
  const byDay = new Map();
  for (const entry of scored) {
    const key = memeDayKey(entry.meme.postedAt, tz);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(entry);
  }
  const survivors = [];
  for (const bucket of byDay.values()) {
    const dayFloor = Math.max(minFloor, garbageFraction * median(bucket.map((e) => e.score)));
    for (const entry of bucket) {
      if (entry.score >= dayFloor) survivors.push(entry);
    }
  }

  return survivors
    .sort(compareNewestFirst)
    .slice(0, limit)
    .map(({ meme, score }, i) => ({
      ...meme,
      trendScore: Math.round(score * 1000) / 1000,
      trendRank: i + 1,
    }));
}
