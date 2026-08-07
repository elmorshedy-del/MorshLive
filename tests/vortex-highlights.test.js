import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildHighlightLookup,
  classifyHighlightTitle,
  normalizeHighlightBucket,
  pickPrimaryHighlight,
} = require("../scripts/vortex-highlights-lib.js");

describe("classifyHighlightTitle", () => {
  it("labels goals and full reels", () => {
    expect(classifyHighlightTitle("أهداف مباراة مصر والأرجنتين")).toBe("goals");
    expect(classifyHighlightTitle("ملخص مباراة مصر والأرجنتين")).toBe("full");
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
