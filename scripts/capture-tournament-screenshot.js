#!/usr/bin/env node
/**
 * Mobile screenshots of tournament page — poster, tweet media, video modal.
 * Usage: node scripts/capture-tournament-screenshot.js [baseUrl] [outDir]
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const OUT_DIR = process.argv[3] || "/opt/cursor/artifacts/screenshots";
const URL = `${BASE}/tournament.html`;

async function shot(page, name) {
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file, type: "png", fullPage: false });
  console.log("Wrote", file);
  return file;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });

  console.log("Loading", URL);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 90000 });

  await page.waitForSelector("#tournament-featured:not([hidden])", { timeout: 60000 });
  await page.waitForSelector(".kz-tweet__media img", { timeout: 60000 });
  await page.waitForTimeout(1500);

  const featured = page.locator("#tournament-featured");
  await featured.screenshot({
    path: path.join(OUT_DIR, "tournament-featured-tweets.png"),
    type: "png",
  });
  console.log("Wrote", path.join(OUT_DIR, "tournament-featured-tweets.png"));

  await shot(page, "tournament-hero-poster.png");

  const launch = page.locator(".tournament-video-launch").first();
  await launch.scrollIntoViewIfNeeded();
  await launch.click();
  await page.waitForSelector("#tournament-video-modal:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(2000);
  await shot(page, "tournament-video-modal.png");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.35));
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(OUT_DIR, "tournament-tweet-rail.png"),
    type: "png",
    fullPage: false,
  });
  console.log("Wrote", path.join(OUT_DIR, "tournament-tweet-rail.png"));

  const mediaCount = await page.locator(".kz-tweet__media img").count();
  const avatarCount = await page.locator(".kz-tweet__avatar--img").count();
  console.log(`Verified: ${mediaCount} tweet media previews, ${avatarCount} avatars`);

  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
