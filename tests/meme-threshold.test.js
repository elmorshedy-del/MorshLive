import { describe, expect, it } from "vitest";
import {
  computeTodayTweetThreshold,
  homeMemeLikesThreshold,
  likesThresholdForTopFraction,
  memeIsToday,
} from "../lib/meme-threshold.js";

describe("likesThresholdForTopFraction", () => {
  it("keeps top fraction by likes", () => {
    const entries = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((likes) => ({ likes }));
    expect(likesThresholdForTopFraction(entries, 0.7)).toBe(4);
  });
});

describe("computeTodayTweetThreshold", () => {
  const cap = 21000;
  const config = { homeTodayRampHours: 18, homeTodayMinAgeFactor: 0.05, homeTodayMinLikes: 0 };
  const now = Date.parse("2026-07-08T12:00:00Z");

  it("ramps from min factor at post time to full cap", () => {
    const posted30m = new Date(now - 0.5 * 3600000).toISOString();
    const posted18h = new Date(now - 18 * 3600000).toISOString();
    expect(computeTodayTweetThreshold(posted30m, cap, config, now)).toBe(1050);
    expect(computeTodayTweetThreshold(posted18h, cap, config, now)).toBe(cap);
  });
});

describe("homeMemeLikesThreshold", () => {
  const now = Date.parse("2026-07-08T12:00:00Z");
  const config = { homeRecentDays: 2, homeTodayRampHours: 18, homeTodayMinAgeFactor: 0.05 };
  const stats = { threshold: 21000 };
  const recentStats = { threshold: 8000 };

  it("uses age-scaled bar for today", () => {
    const m = { postedAt: new Date(now - 2 * 3600000).toISOString() };
    expect(homeMemeLikesThreshold(m, stats, recentStats, config, 3, now)).toBeLessThan(8000);
    expect(memeIsToday(m.postedAt, 3, now)).toBe(true);
  });

  it("uses recent cap for yesterday", () => {
    const m = { postedAt: new Date(now - 26 * 3600000).toISOString() };
    expect(homeMemeLikesThreshold(m, stats, recentStats, config, 3, now)).toBe(8000);
  });
});
