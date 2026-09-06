import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_TS_CONFIG, MPEGTS_VERSION } from "../lib/mpegts-config.js";

// CHATGPT-STAMP 2026-09-06T14:56-04:00 — STREAM-LOCK-TEST-ALIGN-1
// Production intentionally has two measured-good playback configs:
// - IPTV Lab is frozen byte-for-byte at Claude fix 1 and keeps its inline TS config.
// - KoraZero public watch/admin use the later shared KZ_LIVE_TS_CONFIG.
const PLAYER_PAGES = ["watch.html", "iptv-lab.html", "iptv-admin.html"];
const SHARED_CONFIG_PAGES = ["watch.html", "iptv-admin.html"];
const SHARED_CONFIG_SCRIPTS = ["assets/js/watch.js", "assets/js/watch-xtream.js"];

function readRepoFile(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

/** Evaluate the browser mirror without a DOM, and hand back what it published. */
function browserConfig() {
  const source = readRepoFile("assets/js/mpegts-config.js");
  const window = {};
  new Function("window", source)(window);
  return window.KZ_LIVE_TS_CONFIG;
}

describe("MPEG-TS live config", () => {
  it("keeps the browser mirror identical to the canonical module", () => {
    expect(browserConfig()).toEqual({ ...LIVE_TS_CONFIG });
  });

  it("holds the values measured good against the production proxy", () => {
    // liveSync freezes live streams (upstream issue #276) and
    // enableWorkerForMSE needs MSE-in-Workers, which iOS Safari 17 lacks.
    expect(LIVE_TS_CONFIG.liveSync).toBe(false);
    expect(LIVE_TS_CONFIG.enableWorkerForMSE).toBe(false);
    expect(LIVE_TS_CONFIG.enableWorker).toBe(false);
    expect(LIVE_TS_CONFIG.enableStashBuffer).toBe(false);
    expect(LIVE_TS_CONFIG.stashInitialSize).toBe(128);
  });

  it("loads one pinned mpegts.js build on every page that plays a stream", () => {
    for (const page of PLAYER_PAGES) {
      const html = readRepoFile(page);
      const versions = [...html.matchAll(/mpegts\.js@([\d.]+)\//g)].map((m) => m[1]);
      expect(versions, `${page} should load mpegts.js`).not.toHaveLength(0);
      for (const version of versions) {
        expect(version, `${page} pins mpegts.js@${version}`).toBe(MPEGTS_VERSION);
      }
    }
  });

  it("has KoraZero shared-config pages load the shared config", () => {
    for (const page of SHARED_CONFIG_PAGES) {
      const html = readRepoFile(page);
      expect(html, `${page} should load mpegts-config.js`).toContain("assets/js/mpegts-config.js");
    }
  });

  it("preserves the locked Claude-fix-1 Lab config instead of importing KZ Live config", () => {
    const html = readRepoFile("iptv-lab.html");
    const source = readRepoFile("assets/js/iptv-lab.js");
    expect(html).not.toContain("assets/js/mpegts-config.js");
    expect(source).toMatch(/enableWorker\s*:\s*false/);
    expect(source).toMatch(/enableStashBuffer\s*:\s*false/);
    expect(source).toMatch(/stashInitialSize\s*:\s*128/);
  });

  it("leaves no hand-rolled MPEG-TS config in KoraZero shared-config player scripts", () => {
    for (const file of SHARED_CONFIG_SCRIPTS) {
      const source = readRepoFile(file);
      expect(source, `${file} should not inline stashInitialSize`).not.toMatch(/stashInitialSize\s*:/);
    }
  });
});
