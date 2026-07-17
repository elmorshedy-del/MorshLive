import { describe, expect, it } from "vitest";
import {
  dedupeByContent,
  diversifyByAuthor,
  rankTrendingMemes,
  trendScore,
  weightedEngagement,
} from "../lib/trend-rank.js";

const NOW = Date.parse("2026-07-17T12:00:00Z");

const meme = (
  id,
  {
    likes = 0,
    retweets = 0,
    engagement,
    ageHours = 1,
    author = `u_${id}`,
    mediaUrl,
    mediaType = "photo",
  } = {},
) => ({
  tweetId: id,
  author,
  likes,
  retweets,
  ...(engagement != null ? { engagement } : {}),
  postedAt: new Date(NOW - ageHours * 3600000).toISOString(),
  media: [{ type: mediaType, url: mediaUrl || `https://pbs.twimg.com/${id}.jpg` }],
});

describe("weightedEngagement", () => {
  it("counts retweets double", () => {
    expect(weightedEngagement({ likes: 100, retweets: 50 })).toBe(200);
  });

  it("falls back to the precomputed engagement field", () => {
    expect(weightedEngagement({ engagement: 750 })).toBe(750);
  });

  it("prefers real counts over the engagement field when present", () => {
    expect(weightedEngagement({ likes: 10, engagement: 9999 })).toBe(10);
  });
});

describe("trendScore", () => {
  it("ranks a fresh post with traction above an older post with more likes", () => {
    const fresh = trendScore(meme("f", { likes: 5000, ageHours: 6 }), { nowMs: NOW });
    const stale = trendScore(meme("s", { likes: 20000, ageHours: 48 }), { nowMs: NOW });
    expect(fresh).toBeGreaterThan(stale);
  });

  it("still lets a genuinely viral post beat a barely-liked fresh one", () => {
    const tiny = trendScore(meme("t", { likes: 30, ageHours: 3 }), { nowMs: NOW });
    const viral = trendScore(meme("v", { likes: 60000, ageHours: 24 }), { nowMs: NOW });
    expect(viral).toBeGreaterThan(tiny);
  });

  it("boosts video over an identical photo", () => {
    const photo = trendScore(meme("p", { likes: 1000, ageHours: 5 }), { nowMs: NOW });
    const video = trendScore(meme("v", { likes: 1000, ageHours: 5, mediaType: "video" }), { nowMs: NOW });
    expect(video).toBeGreaterThan(photo);
  });

  it("returns 0 for an unparseable postedAt", () => {
    expect(trendScore({ likes: 9999, postedAt: "not-a-date" }, { nowMs: NOW })).toBe(0);
  });
});

describe("dedupeByContent", () => {
  it("keeps the higher-scoring repost of the same media", () => {
    const a = { meme: meme("a", { mediaUrl: "https://pbs.twimg.com/same.jpg" }), score: 5 };
    const b = { meme: meme("b", { mediaUrl: "https://PBS.twimg.com/same.jpg " }), score: 9 };
    const out = dedupeByContent([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].meme.tweetId).toBe("b");
  });
});

describe("diversifyByAuthor", () => {
  const entry = (id, author, score) => ({ meme: meme(id, { author }), score });

  it("caps an author at authorCap while slots can go to others", () => {
    const scored = [
      entry("a1", "spam", 10),
      entry("a2", "spam", 9),
      entry("a3", "spam", 8),
      entry("b1", "other", 1),
    ];
    const out = diversifyByAuthor(scored, 3, 2);
    expect(out.map((e) => e.meme.tweetId)).toEqual(["a1", "a2", "b1"]);
  });

  it("backfills with skipped entries when the pool is too small to fill otherwise", () => {
    const scored = [entry("a1", "spam", 10), entry("a2", "spam", 9), entry("a3", "spam", 8)];
    const out = diversifyByAuthor(scored, 3, 2);
    expect(out.map((e) => e.meme.tweetId)).toEqual(["a1", "a2", "a3"]);
  });
});

describe("rankTrendingMemes", () => {
  it("orders hottest-first and attaches trendScore/trendRank", () => {
    const out = rankTrendingMemes(
      [meme("slow", { likes: 20000, ageHours: 60 }), meme("hot", { likes: 6000, ageHours: 4 })],
      { nowMs: NOW },
    );
    expect(out.map((m) => m.tweetId)).toEqual(["hot", "slow"]);
    expect(out[0].trendRank).toBe(1);
    expect(out[0].trendScore).toBeGreaterThan(out[1].trendScore);
  });

  it("excludes posts outside the 7-day ceiling even when the rail is short", () => {
    const out = rankTrendingMemes(
      [meme("fresh", { likes: 500, ageHours: 12 }), meme("ancient", { likes: 500000, ageHours: 20 * 24 })],
      { nowMs: NOW },
    );
    expect(out.map((m) => m.tweetId)).toEqual(["fresh"]);
  });

  it("widens from 3 days to the 7-day ceiling when the 3-day pool is short", () => {
    const out = rankTrendingMemes(
      [meme("d5", { likes: 8000, ageHours: 5 * 24 }), meme("d6", { likes: 3000, ageHours: 6 * 24 })],
      { nowMs: NOW },
    );
    expect(out.map((m) => m.tweetId)).toEqual(["d5", "d6"]);
  });

  it("caps at the limit", () => {
    const memes = Array.from({ length: 40 }, (_, i) => meme(`m${i}`, { likes: 1000 + i, ageHours: 10 }));
    expect(rankTrendingMemes(memes, { nowMs: NOW, limit: 20 })).toHaveLength(20);
  });

  it("is deterministic on exact ties (newer first, then id)", () => {
    const a = meme("aaa", { likes: 100, ageHours: 5 });
    const b = meme("bbb", { likes: 100, ageHours: 5 });
    const out1 = rankTrendingMemes([a, b], { nowMs: NOW });
    const out2 = rankTrendingMemes([b, a], { nowMs: NOW });
    expect(out1.map((m) => m.tweetId)).toEqual(out2.map((m) => m.tweetId));
  });

  it("keeps one account from flooding the rail", () => {
    const spam = Array.from({ length: 6 }, (_, i) =>
      meme(`s${i}`, { likes: 9000 - i, ageHours: 2, author: "MemeFactory" }),
    );
    const other = meme("solo", { likes: 50, ageHours: 2, author: "SmallAccount" });
    const out = rankTrendingMemes([...spam, other], { nowMs: NOW, limit: 3 });
    expect(out.filter((m) => m.author === "MemeFactory")).toHaveLength(2);
    expect(out.find((m) => m.author === "SmallAccount")).toBeTruthy();
  });
});
