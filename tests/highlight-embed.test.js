import { describe, expect, it } from "vitest";
import {
  isTrueHighlightClip,
  isWorldCupHighlight,
  replayEmbedUrl,
  youtubeVideoId,
} from "../lib/highlight-embed.js";

describe("youtubeVideoId", () => {
  it("reads watch, short, and youtu.be URLs", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=abcdefghijk")).toBe("abcdefghijk");
    expect(youtubeVideoId("https://youtu.be/abcdefghijk")).toBe("abcdefghijk");
    expect(youtubeVideoId("https://www.youtube.com/embed/abcdefghijk")).toBe("abcdefghijk");
  });
});

describe("replayEmbedUrl", () => {
  it("rewrites Vortex embeds onto the same-origin replay proxy", () => {
    expect(replayEmbedUrl("https://nvtboo.vortexvisionworks.com/embed/6BkPxr1tWuNIq")).toBe(
      "/replay/embed/6BkPxr1tWuNIq",
    );
  });

  it("converts YouTube watch links to embed URLs", () => {
    expect(replayEmbedUrl("https://www.youtube.com/watch?v=abcdefghijk")).toBe(
      "https://www.youtube.com/embed/abcdefghijk?rel=0",
    );
  });
});

describe("isTrueHighlightClip", () => {
  it("accepts league highlight titles, not only World Cup wording", () => {
    expect(
      isTrueHighlightClip({
        videoUrl: "https://example.com/v",
        title: "ملخص مباراة ارسنال وكوفنتري سيتي (3-0) الدوري الانجليزي",
      }),
    ).toBe(true);
    expect(
      isTrueHighlightClip({
        videoUrl: "https://example.com/v",
        title: "أهداف آرسنال في الدوري الإنجليزي",
      }),
    ).toBe(true);
  });

  it("rejects full-match replays", () => {
    expect(
      isTrueHighlightClip({
        videoUrl: "https://example.com/v",
        title: "مباراة كاملة ارسنال وكوفنتري",
      }),
    ).toBe(false);
  });
});

describe("isWorldCupHighlight", () => {
  it("does not treat Premier League fixtures as World Cup archive rows", () => {
    expect(
      isWorldCupHighlight({
        home: "Arsenal",
        away: "Coventry City",
        league: "English Premier League",
        leagueAr: "الدوري الإنجليزي الممتاز",
        leagueSlug: "eng.1",
        competition: "epl",
      }),
    ).toBe(false);
  });

  it("keeps FIFA World Cup rows on the archive path", () => {
    expect(
      isWorldCupHighlight({
        leagueSlug: "fifa.world",
        id: "espn-fifa.world-1",
      }),
    ).toBe(true);
  });
});
