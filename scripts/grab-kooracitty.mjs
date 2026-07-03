#!/usr/bin/env node
/**
 * Headless grab of kooracitty stream URLs (needs playwright-core + chromium).
 * Usage: npx playwright-core install chromium && node scripts/grab-kooracitty.mjs
 *
 * kooracitty only injects players client-side near kickoff — run during a live match.
 */
import { chromium } from "playwright-core";

const START_URLS = [
  process.argv[2] || "https://kooracitty.com/matches-today-1/",
];

const hits = new Set();
const embeds = new Set();

function note(url) {
  const u = String(url || "");
  if (!u.startsWith("http")) return;
  if (/\.m3u8(\?|$)/i.test(u)) hits.add(u);
  if (/player|embed|albaplayer|stream/i.test(u)) embeds.add(u);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
});
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  locale: "ar",
  viewport: { width: 1366, height: 768 },
});
const page = await context.newPage();
page.on("request", (req) => note(req.url()));
page.on("response", (res) => {
  note(res.url());
  const ct = (res.headers()["content-type"] || "").toLowerCase();
  if (ct.includes("mpegurl") || res.url().includes(".m3u8")) hits.add(res.url());
});

for (const url of START_URLS) {
  console.log("OPEN", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(5000);
  const links = await page.$$eval("a[href]", (as) =>
    as.map((a) => a.href).filter((h) => /\/matches\//.test(h))
  );
  for (const link of links.slice(0, 5)) {
    console.log("FOLLOW", link);
    await page.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    const html = await page.content();
    for (const m of html.matchAll(/https?:\/\/[^"'\\s<>]+\.m3u8[^"'\\s<>]*/gi)) hits.add(m[0]);
    for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) embeds.add(m[1]);
    if (hits.size) break;
  }
  if (hits.size) break;
}

await browser.close();

console.log("\n=== M3U8 ===");
for (const u of hits) console.log(u);
console.log("\n=== EMBEDS ===");
for (const u of embeds) console.log(u);

if (!hits.size) {
  console.error("\nNo m3u8 captured — try again during a live match on kooracitty.");
  process.exit(2);
}
