import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("watch-page Arabic search heading", () => {
  it("keeps بث مباشر in the initial H1 markup before JavaScript runs", () => {
    const html = readFileSync("watch.html", "utf8");
    expect(html).toMatch(
      /<h1 class="watch-topline__title">[\s\S]*<span class="watch-live-word"[^>]*>بث مباشر<\/span>[\s\S]*<\/h1>/,
    );
  });

  it("uses و between Arabic team names instead of ضد", () => {
    const i18n = readFileSync("assets/js/i18n-core.js", "utf8");
    const watch = readFileSync("assets/js/watch.js", "utf8");

    expect(i18n).toContain('"watch.vs": "و"');
    expect(i18n).not.toContain('"watch.vs": "ضد"');
    expect(watch).toContain('t("watch.vs")');
  });
});
