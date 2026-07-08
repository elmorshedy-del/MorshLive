import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildHighlightLookup,
  classifyHighlightTitle,
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
