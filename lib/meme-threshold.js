/** Pure meme likes-threshold helpers — shared by worker + tests. */

export function likesThresholdForTopFraction(entries, keepFraction = 0.75) {
  const sorted = (entries || []).map((e) => Number(e.likes) || 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const drop = Math.floor(sorted.length * (1 - keepFraction));
  const idx = Math.min(Math.max(drop, 0), sorted.length - 1);
  return sorted[idx];
}

export function memeDayKey(postedAt, tzOffsetHours = 3) {
  const t = Date.parse(postedAt || "");
  if (Number.isNaN(t)) return "";
  return new Date(t + tzOffsetHours * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function todayMemeDayKey(tzOffsetHours = 3, nowMs = Date.now()) {
  return memeDayKey(new Date(nowMs).toISOString(), tzOffsetHours);
}

export function recentMemeDayKeys(tzOffsetHours = 3, dayCount = 3, nowMs = Date.now()) {
  const keys = [];
  const now = nowMs + tzOffsetHours * 60 * 60 * 1000;
  for (let i = dayCount - 1; i >= 0; i--) {
    keys.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
  }
  return keys;
}

export function memeInRecentDays(postedAt, tzOffsetHours = 3, dayCount = 3, nowMs = Date.now()) {
  const key = memeDayKey(postedAt, tzOffsetHours);
  return key && recentMemeDayKeys(tzOffsetHours, dayCount, nowMs).includes(key);
}

export function memeIsRecent(postedAt, tzOffsetHours = 3, recentDays = 2, nowMs = Date.now()) {
  const key = memeDayKey(postedAt, tzOffsetHours);
  return key && recentMemeDayKeys(tzOffsetHours, recentDays, nowMs).includes(key);
}

export function memeIsToday(postedAt, tzOffsetHours = 3, nowMs = Date.now()) {
  return memeDayKey(postedAt, tzOffsetHours) === todayMemeDayKey(tzOffsetHours, nowMs);
}

export function memeAgeHours(postedAt, nowMs = Date.now()) {
  const t = Date.parse(postedAt || "");
  if (Number.isNaN(t)) return 24;
  return Math.max(0, (nowMs - t) / 3600000);
}

export function computeTodayTweetThreshold(postedAt, capThreshold, memeConfig, nowMs = Date.now()) {
  const cap = Math.max(0, Number(capThreshold) || 0);
  if (!cap) return 0;
  const rampHours = Number(memeConfig.homeTodayRampHours) || 18;
  const minLikes = Number(memeConfig.homeTodayMinLikes) || 0;
  const minFactor = Number(memeConfig.homeTodayMinAgeFactor) || 0.05;
  const ageHours = memeAgeHours(postedAt, nowMs);
  if (ageHours >= rampHours) return cap;
  const factor = Math.max(minFactor, ageHours / rampHours);
  return Math.max(minLikes, Math.ceil(cap * factor));
}

export function homeMemeLikesThreshold(m, stats, recentStats, config, tz, nowMs = Date.now()) {
  const standard = Number(stats?.threshold) || 0;
  const recentCap = Math.min(Number(recentStats?.threshold) || standard, standard);
  // Ramp the bar by ACTUAL age in hours, not the local-day bucket. A strong meme
  // posted a few hours ago hasn't had time to reach the full viral like count, so
  // it needs a proportionally lower bar. Keying this on `memeIsToday` (a calendar
  // day with a tz offset) dropped genuinely fresh memes that had crossed local
  // midnight — e.g. a 7h-old post judged against the full "recent" bar and
  // filtered out. Real elapsed hours ramp smoothly through midnight, so freshness
  // is measured by age, not by which calendar day the post landed on.
  const rampHours = Number(config.homeTodayRampHours) || 18;
  if (memeAgeHours(m.postedAt, nowMs) < rampHours) {
    return computeTodayTweetThreshold(m.postedAt, recentCap, config, nowMs);
  }
  if (memeIsRecent(m.postedAt, tz, config.homeRecentDays || 2, nowMs)) return recentCap;
  return standard;
}
