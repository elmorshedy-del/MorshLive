#!/usr/bin/env node
/** Quick headless check of bein-lab player + APIs */
import { chromium } from "playwright";

const BASE = process.env.LAB_URL || "https://korazero.com";
const url = `${BASE}/bein-lab`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

const api = { streams: null, siir: null };
page.on("response", async (res) => {
  const u = res.url();
  if (u.includes("/api/streams-lab")) {
    try {
      api.streams = await res.json();
    } catch {}
  }
  if (u.includes("/api/siir-matches")) {
    try {
      api.siir = await res.json();
    } catch {}
  }
});

await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
await page.waitForTimeout(8000);

const iframe = page.frameLocator("#player");
let iframeSrc = await page.locator("#player").getAttribute("src");
const nowLabel = await page.locator("#now-label").textContent();
const status = await page.locator("#status-line").textContent();
const liveBadge = await page.locator("#live-count").textContent();

let videoInfo = null;
try {
  videoInfo = await iframe.locator("video").evaluate((v) => ({
    paused: v.paused,
    readyState: v.readyState,
    currentTime: v.currentTime,
    src: v.currentSrc?.slice(0, 80),
    w: v.videoWidth,
    h: v.videoHeight,
  }));
} catch (e) {
  videoInfo = { error: String(e) };
}

const cards = await page.locator(".lab-card.is-live").count();
const gridCards = await page.locator("#channel-grid .lab-card").count();

console.log(JSON.stringify({
  url,
  iframeSrc,
  nowLabel: nowLabel?.trim(),
  status: status?.trim(),
  liveBadge: liveBadge?.trim(),
  liveCards: cards,
  gridCards,
  apiLive: api.streams?.liveCount,
  apiBest: api.streams?.best?.route,
  siirOk: api.siir?.ok,
  videoInfo,
  jsErrors: errors.slice(0, 8),
}, null, 2));

await browser.close();
const ok =
  iframeSrc &&
  iframeSrc !== "about:blank" &&
  !iframeSrc.includes("about:blank") &&
  (api.streams?.liveCount > 0 || gridCards > 0);
process.exit(ok ? 0 : 1);
