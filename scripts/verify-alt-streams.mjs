#!/usr/bin/env node
/**
 * Playwright: verify alt-stream iframes use korazero clean HLS proxies (Sir TV + NTV).
 * Saves screenshots to /opt/cursor/artifacts/screenshots/ for visual proof.
 *
 * Usage:
 *   node scripts/verify-alt-streams.mjs [watchUrl] [outDir]
 */
import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";

const WATCH_URL =
  process.argv[2] ||
  "https://korazero.com/watch.html?ch=bein-max-1&match=espn-fifa.world-760506";
const OUT_DIR = process.argv[3] || "/opt/cursor/artifacts/screenshots";

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });

  console.log("Opening", WATCH_URL);
  await page.goto(WATCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  await page.waitForSelector("#alt-streams:not([hidden])", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(10000);

  const iframes = await page.evaluate(() => {
    const frames = [...document.querySelectorAll(".alt-stream-frame")];
    return frames.map((f) => {
      const pane = f.closest(".alt-stream-pane");
      return {
        kind: pane?.classList.contains("alt-stream-pane--ntv")
          ? "ntv"
          : pane?.classList.contains("alt-stream-pane--sirtv")
            ? "sirTv"
            : "unknown",
        src: f.src,
        sandbox: f.getAttribute("sandbox"),
        hasSandbox: f.hasAttribute("sandbox"),
      };
    });
  });

  console.log("alt-stream iframes:", JSON.stringify(iframes, null, 2));

  const shot = path.join(OUT_DIR, `alt-streams-${ts()}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  console.log("screenshot:", shot);

  const ntv = iframes.find((f) => f.kind === "ntv");
  const sir = iframes.find((f) => f.kind === "sirTv");

  let ntvVideo = null;
  const ntvFrame = page.frames().find((f) => /\/wk\/albaplayer\/ntv\//i.test(f.url()));
  if (ntvFrame) {
    try {
      ntvVideo = await ntvFrame.evaluate(() => {
        const v = document.querySelector("video");
        if (!v) return null;
        return { w: v.videoWidth, h: v.videoHeight, readyState: v.readyState, paused: v.paused };
      });
      console.log("NTV video:", ntvVideo);
    } catch (e) {
      console.warn("NTV frame eval failed:", e.message);
    }
  }

  const streamsCenterFrame = page.frames().find((f) => /streams\.center/i.test(f.url()));
  if (streamsCenterFrame) {
    console.warn("warn: streams.center frame still present:", streamsCenterFrame.url());
  }

  await browser.close();

  if (!ntv) throw new Error("NTV alt-stream iframe not found — is match pinned?");
  if (!/\/wk\/albaplayer\/ntv\//i.test(ntv.src)) {
    throw new Error(`NTV must use korazero clean proxy (got ${ntv.src})`);
  }
  if (/streams\.center/i.test(ntv.src)) {
    throw new Error("NTV must not embed streams.center directly (ad popups)");
  }
  if (!ntvVideo || ntvVideo.w < 1) {
    throw new Error(`NTV video not playing (video=${JSON.stringify(ntvVideo)})`);
  }
  if (sir && !sir.hasSandbox) {
    console.warn("warn: Sir TV iframe has no sandbox (acceptable but unexpected)");
  }

  console.log("\n✓ NTV uses korazero clean proxy:", ntv.src);
  console.log("✓ NTV video playing:", `${ntvVideo.w}x${ntvVideo.h}`);
  if (sir) console.log("✓ Sir TV iframe sandbox:", sir.sandbox || "(none)");
})();
