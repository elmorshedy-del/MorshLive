import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const EXACT_MATCH_ID = "espn-esp.1-401882859";
const PAGE_URL = "/barcelona-live.html";
const STREAM_URL = "https://v2-mist-production.up.railway.app/hls/iptv-3645/index.m3u8";

function loadMatchdayApi() {
  const helperPath = "assets/js/barcelona-matchday.js";
  expect(existsSync(helperPath)).toBe(true);

  const window = {};
  vm.runInNewContext(readFileSync(helperPath, "utf8"), {
    window,
    console,
  });

  return window.KZBarcelonaMatchday;
}

describe("isolated Barcelona matchday route", () => {
  it("routes only the exact live fixture to the clean page", () => {
    const api = loadMatchdayApi();

    expect(api.hrefFor({ id: EXACT_MATCH_ID })).toBe(PAGE_URL);
    expect(api.hrefFor({ id: "another-barcelona-fixture" })).toBe("");
    expect(api.hrefFor(null)).toBe("");
  });

  it("mounts V2 once and never remounts the same player shell", async () => {
    const api = loadMatchdayApi();
    const loaded = [];
    let replacements = 0;

    class FakeHls {
      static isSupported() {
        return true;
      }

      loadSource(url) {
        loaded.push(url);
      }

      attachMedia(video) {
        this.video = video;
      }
    }

    const video = {
      autoplay: false,
      controls: false,
      muted: false,
      playsInline: false,
      canPlayType: () => "",
      play: () => Promise.resolve(),
      setAttribute: () => {},
    };
    const shell = {
      dataset: {},
      replaceChildren(child) {
        replacements += 1;
        this.child = child;
      },
    };
    const doc = {
      getElementById: (id) => id === "barcelona-v2-player" ? shell : null,
      createElement: (tag) => {
        expect(tag).toBe("video");
        return video;
      },
    };

    expect(api.mount(doc, FakeHls)).toBe(true);
    expect(api.mount(doc, FakeHls)).toBe(false);
    await Promise.resolve();

    expect(replacements).toBe(1);
    expect(loaded).toEqual([STREAM_URL]);
    expect(video.autoplay).toBe(true);
    expect(video.controls).toBe(true);
    expect(video.muted).toBe(true);
  });

  it("keeps the dedicated page outside every shared watch lifecycle", () => {
    const pagePath = "barcelona-live.html";
    expect(existsSync(pagePath)).toBe(true);

    const html = readFileSync(pagePath, "utf8");
    const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map((match) => match[1]);

    expect(scripts).toEqual([
      "https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js",
      "assets/js/barcelona-matchday.js?v=20260919barcelonaisolated1",
    ]);
    expect(html).not.toMatch(/watch-loader|watch\.js|stream-plan|iptv-auto|data\.js/);
  });
});
