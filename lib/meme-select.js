/**
 * Pure home-meme selection helpers — the "which memes show" logic, shared by
 * the worker and tests. No network / env / module-cache: given a pool of memes
 * and the tuning config, decide the per-account likes bar and classify a meme
 * for the home feed. Extracted from worker.js so this scoring is unit-testable
 * and reusable without booting the whole worker.
 */
import {
  homeMemeLikesThreshold,
  likesThresholdForTopFraction,
  memeInRecentDays,
  memeIsRecent,
  memeIsToday,
} from "./meme-threshold.js";

/** World Cup 2026 home-meme window start (accounts' "since" default). */
export const WC_HOME_SINCE_UTC = "2026-06-11T00:00:00Z";

export function memeHasMedia(meme) {
  const item = (meme?.media || [])[0];
  return !!(item && (item.previewUrl || item.url));
}

export function filterMemesWithMedia(memes) {
  return (memes || []).filter(memeHasMedia);
}

/** Per-account likes bar from WC pool — targets ~N viral memes/day for that account. */
export function computeAccountLikesThreshold(pool, memeConfig, nowMs = Date.now()) {
  const entries = (pool || []).filter(memeHasMedia);
  if (!entries.length) {
    return { threshold: 0, keepFraction: 1, estimatedPerDay: 0, poolSize: 0, passing: 0, daysSinceWc: 0 };
  }
  let sinceMs = Date.parse(memeConfig.homeSinceUtc || WC_HOME_SINCE_UTC);
  if (Number.isNaN(sinceMs)) sinceMs = Date.parse(WC_HOME_SINCE_UTC);
  const days = Math.max(1, (nowMs - sinceMs) / 86400000);
  const targetPerDay = memeConfig.homeTargetPerDay || 4;
  const minK = memeConfig.homeMinKeepFraction ?? 0.7;
  const maxK = memeConfig.homeMaxKeepFraction ?? 0.9;
  const keepFraction = Math.min(maxK, Math.max(minK, (targetPerDay * days) / entries.length));
  const threshold = likesThresholdForTopFraction(
    entries.map((c) => ({ likes: c.likes })),
    keepFraction,
  );
  const passing = entries.filter((c) => (Number(c.likes) || 0) >= threshold).length;
  return {
    threshold,
    keepFraction,
    estimatedPerDay: passing / days,
    poolSize: entries.length,
    passing,
    daysSinceWc: Math.round(days),
  };
}

/** Softer bar for tweets from the last ~2 days — top N by likes, never above WC bar. */
export function computeRecentAccountThreshold(recentPool, memeConfig, standardStats) {
  const entries = (recentPool || []).filter(memeHasMedia);
  const recentDays = memeConfig.homeRecentDays || 2;
  const targetTotal = (memeConfig.homeRecentTargetPerDay ?? memeConfig.homeTargetPerDay ?? 4) * recentDays;
  if (!entries.length) {
    return {
      threshold: 0,
      keepFraction: 1,
      estimatedPerDay: 0,
      poolSize: 0,
      passing: 0,
      recentDays,
      targetTotal,
    };
  }
  const sorted = entries.map((c) => Number(c.likes) || 0).sort((a, b) => a - b);
  const keep = Math.min(Math.max(targetTotal, 1), sorted.length);
  const idx = Math.max(0, sorted.length - keep);
  let threshold = sorted[idx] || 0;
  const standardCap = Number(standardStats?.threshold) || threshold;
  threshold = Math.min(threshold, standardCap);
  const passing = entries.filter((c) => (Number(c.likes) || 0) >= threshold).length;
  return {
    threshold,
    keepFraction: keep / sorted.length,
    estimatedPerDay: passing / recentDays,
    poolSize: entries.length,
    passing,
    recentDays,
    targetTotal,
  };
}

// Home "best memes" scroll: how many, and how recent the candidate pool is.
export const HOME_SCROLL_LIMIT = 20;
export const HOME_SCROLL_POOL_DAYS = 3;
// Prefer the last 3 days; widen to a 7-day ceiling if that's short. We do NOT
// widen further: reaching weeks back to hit a count fills the scroll with stale
// group-stage memes, which reads as broken. Better to show the few genuinely
// recent memes (or nothing, signalling a stale ingest) than old ones dressed up
// as "recent". A healthy ingest fills the last 3 days on its own.
const HOME_SCROLL_POOL_WIDEN_DAYS = [3, 7];

function memeEngagement(meme) {
  return Number(meme.engagement) || Number(meme.likes) || 0;
}

function memePostedMs(meme) {
  const t = Date.parse(meme.postedAt || "");
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Home scroll selection: take a recent pool (last `poolDays`, 7-day ceiling),
 * keep the `limit` BEST by engagement, then order those by RECENCY (newest
 * first) for display. Deliberately does not reach past the ceiling to hit the
 * count — a short scroll of truly recent memes beats a full one of stale ones.
 */
export function selectHomeScrollMemes(memes, opts = {}) {
  const limit = opts.limit || HOME_SCROLL_LIMIT;
  const nowMs = opts.nowMs || Date.now();
  const list = memes || [];
  const windows = opts.poolDays ? [opts.poolDays] : HOME_SCROLL_POOL_WIDEN_DAYS;

  // Prefer the freshest window; widen only up to the ceiling if it's short.
  let pool = [];
  for (const days of windows) {
    pool = list.filter((m) => memePostedMs(m) >= nowMs - days * 86400000);
    if (pool.length >= limit) break;
  }

  return [...pool]
    .sort((a, b) => memeEngagement(b) - memeEngagement(a)) // filter by BEST
    .slice(0, limit)
    .sort((a, b) => memePostedMs(b) - memePostedMs(a)); // arrange by RECENT
}

export function classifyHomeMeme(m, stats, recentStats, config, tz, displayDays, nowMs = Date.now()) {
  if (!memeInRecentDays(m.postedAt, tz, displayDays, nowMs)) return null;
  const isToday = memeIsToday(m.postedAt, tz, nowMs);
  const isRecent = isToday || memeIsRecent(m.postedAt, tz, config.homeRecentDays || 2, nowMs);
  const threshold = homeMemeLikesThreshold(m, stats, recentStats, config, tz, nowMs);
  const passing = (Number(m.likes) || 0) >= threshold;
  return {
    isRecent,
    isToday,
    threshold,
    passing,
    entry: { ...m, likesThreshold: threshold, recent: isRecent, today: isToday },
  };
}
