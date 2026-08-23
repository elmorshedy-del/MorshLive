import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const loader = readFileSync("assets/js/i18n.js", "utf8");
const refresh = readFileSync("assets/js/site-refresh.js", "utf8");
const dark = readFileSync("assets/css/dark-refresh.css", "utf8");

describe("KoraZero editorial refresh", () => {
  it("keeps the original i18n engine behind the shared refresh layer", () => {
    expect(loader).toContain("i18n-core.js");
    expect(loader).toContain("site-refresh.js");
    expect(loader).toContain("dark-refresh.css");
  });

  it("uses standard football Arabic for own goals and trims FAQ schema to three useful questions", () => {
    expect(refresh).toContain("هدف في مرماه");
    expect(refresh).not.toContain('"faq.q6": "هل كورة زيرو بديل');
    expect(refresh).toContain("[1, 2, 3].map");
  });

  it("keeps high-intent SEO language natural in Arabic and English", () => {
    expect(refresh).toContain("مباريات اليوم بث مباشر ونتائج مباشرة");
    expect(refresh).toContain("Today's Football Matches, Live Scores & Streams");
    expect(refresh).not.toContain("no buffering");
  });

  it("ships the dark theme as the shared default", () => {
    expect(dark).toContain("color-scheme: dark");
    expect(dark).toContain("--bg: #060914");
    expect(dark).toContain("--accent: #18e29a");
  });
});
