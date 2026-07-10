import { describe, expect, it } from "vitest";
import {
  classifyHomeMeme,
  computeAccountLikesThreshold,
  computeRecentAccountThreshold,
  filterMemesWithMedia,
  memeHasMedia,
} from "../lib/meme-select.js";

const withMedia = (likes, postedAt) => ({
  likes,
  postedAt,
  media: [{ url: "https://pbs.twimg.com/media/x.jpg" }],
});

describe("memeHasMedia / filterMemesWithMedia", () => {
  it("keeps only memes carrying a media item", () => {
    const list = [withMedia(10), { likes: 5, media: [] }, { likes: 5 }];
    expect(memeHasMedia(list[0])).toBe(true);
    expect(memeHasMedia(list[1])).toBe(false);
    expect(filterMemesWithMedia(list)).toHaveLength(1);
  });
});

describe("computeAccountLikesThreshold", () => {
  it("returns an empty bar for an empty pool", () => {
    expect(computeAccountLikesThreshold([], {}).threshold).toBe(0);
  });

  it("sets a like bar that keeps the configured fraction of a pool", () => {
    const now = Date.parse("2026-07-08T00:00:00Z");
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => withMedia(n * 100));
    const stats = computeAccountLikesThreshold(pool, { homeTargetPerDay: 4 }, now);
    expect(stats.poolSize).toBe(10);
    expect(stats.threshold).toBeGreaterThan(0);
    expect(stats.passing).toBeGreaterThan(0);
  });
});

describe("computeRecentAccountThreshold", () => {
  it("never exceeds the standard cap", () => {
    const pool = [100, 200, 300, 400].map((n) => withMedia(n));
    const recent = computeRecentAccountThreshold(pool, { homeRecentDays: 2 }, { threshold: 150 });
    expect(recent.threshold).toBeLessThanOrEqual(150);
  });
});

describe("classifyHomeMeme", () => {
  const now = Date.parse("2026-07-08T12:00:00Z");
  const config = { homeRecentDays: 2, homeTodayRampHours: 18, homeTodayMinAgeFactor: 0.05 };

  it("drops memes outside the display window", () => {
    const old = withMedia(9000, new Date(now - 10 * 86400000).toISOString());
    expect(classifyHomeMeme(old, { threshold: 8000 }, { threshold: 4000 }, config, 3, 3, now)).toBeNull();
  });

  it("passes a strong fresh meme against the age-scaled bar", () => {
    const fresh = withMedia(2000, new Date(now - 2 * 3600000).toISOString());
    const res = classifyHomeMeme(fresh, { threshold: 21000 }, { threshold: 8000 }, config, 3, 3, now);
    expect(res.isToday).toBe(true);
    expect(res.passing).toBe(true); // 2000 likes clears the 2h-old ramped bar
  });
});
