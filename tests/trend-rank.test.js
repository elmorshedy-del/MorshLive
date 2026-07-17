import { describe, expect, it } from "vitest";
import {
  clampSinceUtc,
  dedupeByContent,
  qualityScore,
  rankTrendingMemes,
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

describe("qualityScore", () => {
  it("boosts video over an identical photo", () => {
    const photo = qualityScore(meme("p", { likes: 1000 }));
    const video = qualityScore(meme("v", { likes: 1000, mediaType: "video" }));
    expect(video).toBeGreaterThan(photo);
  });
});

describe("clampSinceUtc", () => {
  it("clamps an old window start to maxDays back", () => {
    const clamped = clampSinceUtc("2026-06-11T00:00:00Z", NOW, 7);
    expect(clamped).toBe(new Date(NOW - 7 * 86400000).toISOString());
  });

  it("keeps a start already inside the window", () => {
    const recent = new Date(NOW - 2 * 86400000).toISOString();
    expect(clampSinceUtc(recent, NOW, 7)).toBe(recent);
  });

  it("uses the floor when the input is unparseable", () => {
    expect(clampSinceUtc("garbage", NOW, 7)).toBe(new Date(NOW - 7 * 86400000).toISOString());
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

describe("rankTrendingMemes", () => {
  it("displays newest-first like a feed, regardless of engagement", () => {
    const out = rankTrendingMemes(
      [
        meme("huge-yesterday", { likes: 90000, ageHours: 30 }),
        meme("modest-now", { likes: 800, ageHours: 2 }),
      ],
      { nowMs: NOW },
    );
    expect(out.map((m) => m.tweetId)).toEqual(["modest-now", "huge-yesterday"]);
    expect(out[0].trendRank).toBe(1);
  });

  it("keeps only a day's best when that day overflows its share", () => {
    // 30 posts today, limit 10 → the 10 with the most engagement survive.
    const today = Array.from({ length: 30 }, (_, i) =>
      meme(`t${i}`, { likes: 100 + i, ageHours: 3 + (i % 5) }),
    );
    const out = rankTrendingMemes(today, { nowMs: NOW, limit: 10 });
    expect(out).toHaveLength(10);
    const kept = new Set(out.map((m) => m.tweetId));
    // t29..t20 have the highest like counts — exactly those survive.
    for (let i = 20; i < 30; i++) expect(kept.has(`t${i}`)).toBe(true);
  });

  it("never lets yesterday's viral flood push today's events out", () => {
    const yesterdayFlood = Array.from({ length: 10 }, (_, i) =>
      meme(`y${i}`, { likes: 50000 - i, ageHours: 28 }),
    );
    const todaySmall = [
      meme("goal-today", { likes: 300, ageHours: 2 }),
      meme("reaction-today", { likes: 150, ageHours: 4 }),
    ];
    const out = rankTrendingMemes([...yesterdayFlood, ...todaySmall], { nowMs: NOW, limit: 6 });
    // Today is represented AND leads the feed.
    expect(out[0].tweetId).toBe("goal-today");
    expect(out[1].tweetId).toBe("reaction-today");
    expect(out).toHaveLength(6);
  });

  it("still fills the rail from one day when it holds the whole pool", () => {
    const memes = Array.from({ length: 40 }, (_, i) => meme(`m${i}`, { likes: 1000 + i, ageHours: 10 }));
    expect(rankTrendingMemes(memes, { nowMs: NOW, limit: 20 })).toHaveLength(20);
  });

  it("excludes posts outside the 7-day ceiling while anything fresh exists", () => {
    const out = rankTrendingMemes(
      [meme("fresh", { likes: 500, ageHours: 12 }), meme("ancient", { likes: 500000, ageHours: 20 * 24 })],
      { nowMs: NOW },
    );
    expect(out.map((m) => m.tweetId)).toEqual(["fresh"]);
  });

  it("falls back to the newest available content when the whole ingest is stale", () => {
    // Nothing within 7 days — the rail must still show something (newest first)
    // instead of leaving the homepage section blank.
    const out = rankTrendingMemes(
      [meme("older", { likes: 900, ageHours: 14 * 24 }), meme("newer", { likes: 400, ageHours: 12 * 24 })],
      { nowMs: NOW },
    );
    expect(out.map((m) => m.tweetId)).toEqual(["newer", "older"]);
  });

  it("widens from 3 days to the 7-day ceiling when the 3-day pool is short", () => {
    const out = rankTrendingMemes(
      [meme("d5", { likes: 8000, ageHours: 5 * 24 }), meme("d6", { likes: 3000, ageHours: 6 * 24 })],
      { nowMs: NOW },
    );
    expect(out.map((m) => m.tweetId)).toEqual(["d5", "d6"]);
  });

  it("never limits an author — one account's stronger posts beat weaker ones from others", () => {
    const strong = Array.from({ length: 4 }, (_, i) =>
      meme(`s${i}`, { likes: 9000 - i, ageHours: 2, author: "OneAccount" }),
    );
    const weak = meme("weak", { likes: 50, ageHours: 2, author: "Other" });
    const out = rankTrendingMemes([...strong, weak], { nowMs: NOW, limit: 4 });
    expect(out.every((m) => m.author === "OneAccount")).toBe(true);
  });

  it("is deterministic on exact ties", () => {
    const a = meme("aaa", { likes: 100, ageHours: 5 });
    const b = meme("bbb", { likes: 100, ageHours: 5 });
    const out1 = rankTrendingMemes([a, b], { nowMs: NOW });
    const out2 = rankTrendingMemes([b, a], { nowMs: NOW });
    expect(out1.map((m) => m.tweetId)).toEqual(out2.map((m) => m.tweetId));
  });
});
