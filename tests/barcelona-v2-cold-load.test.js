import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const MATCHDAY_STAMP = "20260919barcelonacold1";

function scriptVersion(html, path) {
  const escaped = path.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`src=["']${escaped}\\?v=([^"']+)["']`));
  return match?.[1] || "";
}

describe("Barcelona V2 cold-load asset graph", () => {
  it("loads every changed routing and player asset under the same fresh cache key", () => {
    const watchHtml = readFileSync("watch.html", "utf8");
    const indexHtml = readFileSync("index.html", "utf8");
    const i18n = readFileSync("assets/js/i18n.js", "utf8");
    const loader = readFileSync("assets/js/watch-loader.js", "utf8");
    const writes = [];

    vm.runInNewContext(loader, {
      URLSearchParams,
      location: { search: "?match=espn-esp.1-401882859" },
      window: {},
      document: { write: (value) => writes.push(String(value)) },
    });

    expect(scriptVersion(indexHtml, "assets/js/i18n.js")).toBe(MATCHDAY_STAMP);
    expect(scriptVersion(watchHtml, "assets/js/i18n.js")).toBe(MATCHDAY_STAMP);
    expect(scriptVersion(watchHtml, "assets/js/data.js")).toBe(MATCHDAY_STAMP);
    expect(scriptVersion(watchHtml, "assets/js/watch-loader.js")).toBe(MATCHDAY_STAMP);
    expect(i18n).toContain(`const stamp = "${MATCHDAY_STAMP}";`);
    expect(writes.join("\n")).toContain(`assets/js/watch.js?v=${MATCHDAY_STAMP}`);
  });
});
