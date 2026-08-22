import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildHighlightLookup,
  classifyHighlightTitle,
  isBetterClip,
  normalizeHighlightBucket,
  pickPrimaryHighlight,
} = require("../scripts/vortex-highlights-lib.js");

describe("classifyHighlightTitle", () => {
  it("labels goals and full reels", () => {
    expect(classifyHighlightTitle("أهداف مباراة مصر والأرجنتين")).toBe("goals");
    expect(classifyHighlightTitle("ملخص مباراة مصر والأرجنتين")).toBe("full");
  });

  it("accepts current-league highlight titles", () => {
    expect(classifyHighlightTitle("ملخص ارسنال وكوفنتري الدوري الانجليزي")).toBe("full");
    expect(classifyHighlightTitle("أهداف ريال بيتيس في الدوري الإسباني")).toBe("goals");
  });

  it("rejects full-match broadcasts", () => {
    expect(classifyHighlightTitle("مباراة كاملة")).toBeNull();
  });
});

describe("pickPrimaryHighlight", () => {
  it("prefers full over goals", () => {
    const h = {
      goals: { videoUrl: "https://example.com/g" },
      full: { videoUrl: "https://example.com/f" },
    };
    expect(pickPrimaryHighlight(h).videoUrl).toBe("https://example.com/f");
  });
});

describe("buildHighlightLookup", () => {
  it("picks best thumbnail per match key", () => {
    const idx = [
      { key: "england~mexico", videoUrl: "https://a", kind: "goals", thumbnail: "" },
      { key: "england~mexico", videoUrl: "https://b", kind: "full", thumbnail: "https://poster" },
    ];
    expect(buildHighlightLookup(idx).get("england~mexico").thumbnail).toBe("https://poster");
  });
});

describe("normalizeHighlightBucket", () => {
  it("drops goals when goals and full share the same videoUrl (btolat dupe pages)", () => {
    const bucket = {
      goals: {
        videoUrl: "https://example.com/tweet/2066682320388579403",
        title: "اهداف مباراة السعودية واوروجواي (1-1) كأس العالم",
      },
      full: {
        videoUrl: "https://example.com/tweet/2066682320388579403",
        title: "ملخص مباراة السعودية واوروجواي (1-1) كأس العالم",
      },
    };
    const out = normalizeHighlightBucket(bucket);
    expect(out.full).toBeTruthy();
    expect(out.goals).toBeUndefined();
  });

  it("keeps both when goals and full have different videoUrls", () => {
    const bucket = {
      goals: {
        videoUrl: "https://example.com/tweet/goals-clip",
        title: "اهداف مباراة السعودية واوروجواي (1-1) كأس العالم",
      },
      full: {
        videoUrl: "https://example.com/tweet/full-clip",
        title: "ملخص مباراة السعودية واوروجواي (1-1) كأس العالم",
      },
    };
    const out = normalizeHighlightBucket(bucket);
    expect(out.goals.videoUrl).toBe("https://example.com/tweet/goals-clip");
    expect(out.full.videoUrl).toBe("https://example.com/tweet/full-clip");
  });

  it("leaves a bucket with only full unchanged", () => {
    const bucket = {
      full: {
        videoUrl: "https://example.com/tweet/full-clip",
        title: "ملخص مباراة السعودية واوروجواي (1-1) كأس العالم",
      },
    };
    const out = normalizeHighlightBucket(bucket);
    expect(out.full.videoUrl).toBe("https://example.com/tweet/full-clip");
    expect(out.goals).toBeUndefined();
  });

  it("leaves a bucket with only goals unchanged", () => {
    const bucket = {
      goals: {
        videoUrl: "https://example.com/tweet/goals-clip",
        title: "اهداف مباراة السعودية واوروجواي (1-1) كأس العالم",
      },
    };
    const out = normalizeHighlightBucket(bucket);
    expect(out.goals.videoUrl).toBe("https://example.com/tweet/goals-clip");
    expect(out.full).toBeUndefined();
  });
});

describe("isBetterClip", () => {
  const vortex = { videoUrl: "https://v/1", source: "vortex" };
  const youtube = { videoUrl: "https://y/1", source: "youtube" };
  const twitter = { videoUrl: "https://t/1", source: "twitter" };

  it("fills an empty slot with anything playable", () => {
    expect(isBetterClip(null, twitter)).toBe(true);
    expect(isBetterClip(undefined, vortex)).toBe(true);
  });

  it("never downgrades vortex to an X card", () => {
    // Regression: btolat's World Cup pages are all X embeds and ran after the
    // curated vortex map, silently replacing a real player with a tweet card.
    expect(isBetterClip(vortex, twitter)).toBe(false);
    expect(isBetterClip(youtube, twitter)).toBe(false);
  });

  it("upgrades an X card when a better source turns up", () => {
    expect(isBetterClip(twitter, vortex)).toBe(true);
    expect(isBetterClip(twitter, youtube)).toBe(true);
  });

  it("does not churn between equal-ranked sources", () => {
    expect(isBetterClip(vortex, { videoUrl: "https://v/2", source: "vortex" })).toBe(false);
  });

  it("ignores an incoming clip with no videoUrl", () => {
    expect(isBetterClip(twitter, { source: "vortex" })).toBe(false);
    expect(isBetterClip(null, null)).toBe(false);
  });
});
