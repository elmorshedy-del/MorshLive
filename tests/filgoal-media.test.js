import { describe, expect, it } from "vitest";
import {
  extractFilgoalMedia,
  extractFilgoalPublishedAt,
  extractFilgoalThumbnail,
  extractFilgoalTitle,
} from "../scripts/lib/filgoal-media.js";

describe("filgoal-media", () => {
  it("extracts a YouTube embed id from an iframe", () => {
    const html = `<iframe src="https://www.youtube.com/embed/WZQT7_jbRDI?autoplay=1&mute=1" frameborder="0" allowfullscreen>`;
    const media = extractFilgoalMedia(html);
    expect(media?.source).toBe("youtube");
    expect(media?.embedId).toBe("WZQT7_jbRDI");
    expect(media?.videoUrl).toBe("https://www.youtube.com/embed/WZQT7_jbRDI");
  });

  it("extracts a Dailymotion embed id when YouTube is absent", () => {
    const html = `<iframe src="https://www.dailymotion.com/embed/video/x9abc12" frameborder="0"></iframe>`;
    const media = extractFilgoalMedia(html);
    expect(media?.source).toBe("dailymotion");
    expect(media?.embedId).toBe("x9abc12");
    expect(media?.videoUrl).toBe("https://www.dailymotion.com/embed/video/x9abc12");
  });

  it("returns null when no known player embed is present", () => {
    expect(extractFilgoalMedia("<p>no video here</p>")).toBeNull();
  });

  it("reads og:title with name before property (filgoal's attribute order)", () => {
    const html = `<meta name="og:title" property="og:title" content="ملخص تعادل مصر مع بلجيكا 1-1 (كأس العالم)" />`;
    expect(extractFilgoalTitle(html)).toBe("ملخص تعادل مصر مع بلجيكا 1-1 (كأس العالم)");
  });

  it("reads og:image with the same attribute order", () => {
    const html = `<meta name="og:image" property="og:image" content="https://i.ytimg.com/vi/WZQT7_jbRDI/hqdefault.jpg" />`;
    expect(extractFilgoalThumbnail(html)).toBe("https://i.ytimg.com/vi/WZQT7_jbRDI/hqdefault.jpg");
  });

  it("reads the JSON-LD datePublished field", () => {
    const html = `"datePublished": "2026-06-16T01:24:00+02:00"`;
    expect(extractFilgoalPublishedAt(html)).toBe("2026-06-16T01:24:00+02:00");
  });
});
