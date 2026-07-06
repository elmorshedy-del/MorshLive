#!/usr/bin/env node
/**
 * Screenshot home page trending X rail (mock /api/recent-memes).
 * Usage: node scripts/capture-home-tweets-screenshot.js [baseUrl] [outDir]
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = process.argv[3] || "/opt/cursor/artifacts/screenshots";
const PORT = 8791;
const BASE = (process.argv[2] || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");

function loadMockMemes() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/data/match-memes.json"), "utf8"));
  const samples = [
    { key: "brazil~norway", home: "Brazil", away: "Norway", score: "3-0" },
    { key: "mexico~southafrica", home: "Mexico", away: "South Africa", score: "2-1" },
    { key: "portugal~spain", home: "Portugal", away: "Spain", score: "1-1" },
    { key: "belgium~unitedstates", home: "Belgium", away: "United States", score: "2-1" },
  ];
  const memes = [];
  for (const s of samples) {
    const list = (raw[s.key] || []).filter((m) => m.media?.[0]?.previewUrl);
    for (const m of list.slice(0, 3)) {
      memes.push({
        ...m,
        home: s.home,
        away: s.away,
        score: s.score,
        matchKey: s.key,
      });
    }
  }
  return memes
    .sort((a, b) => (b.engagement || 0) - (a.engagement || 0))
    .slice(0, 12);
}

function startStaticServer() {
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
  };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (url.pathname === "/api/recent-memes") {
        const memes = loadMockMemes();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ memes, count: memes.length, windowHours: 24, matchCount: 4 }));
        return;
      }
      let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
      if (url.pathname === "/" || url.pathname === "") filePath = path.join(ROOT, "index.html");
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startStaticServer();

  const browser = await chromium.launch({
    executablePath: "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const desktop = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });

  const url = `${BASE}/index.html`;
  console.log("Loading", url);

  for (const page of [mobile, desktop]) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#recent-tweets:not([hidden])", { timeout: 30000 });
    await page.waitForSelector(".kz-tweet-rail--home .kz-tweet__media img", { timeout: 30000 });
    await page.waitForTimeout(1200);
  }

  const sectionMobile = mobile.locator("#recent-tweets");
  await sectionMobile.scrollIntoViewIfNeeded();
  await mobile.screenshot({
    path: path.join(OUT_DIR, "home-tweets-rail-mobile.png"),
    type: "png",
    fullPage: false,
  });
  console.log("Wrote", path.join(OUT_DIR, "home-tweets-rail-mobile.png"));

  await sectionMobile.screenshot({
    path: path.join(OUT_DIR, "home-tweets-section-mobile.png"),
    type: "png",
  });
  console.log("Wrote", path.join(OUT_DIR, "home-tweets-section-mobile.png"));

  const sectionDesktop = desktop.locator("#recent-tweets");
  await sectionDesktop.scrollIntoViewIfNeeded();
  await desktop.screenshot({
    path: path.join(OUT_DIR, "home-tweets-rail-desktop.png"),
    type: "png",
    fullPage: false,
  });
  console.log("Wrote", path.join(OUT_DIR, "home-tweets-rail-desktop.png"));

  await sectionDesktop.screenshot({
    path: path.join(OUT_DIR, "home-tweets-section-desktop.png"),
    type: "png",
  });
  console.log("Wrote", path.join(OUT_DIR, "home-tweets-section-desktop.png"));

  const count = await mobile.locator(".kz-tweet-rail--home .kz-tweet").count();
  console.log(`Verified: ${count} tweet cards in rail`);

  await browser.close();
  server.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
