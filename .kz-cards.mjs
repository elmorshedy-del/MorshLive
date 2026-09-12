/* Does the auto-router rewrite cards into xtream mode, and does it build the
   golden button? Serves the repo locally, proxies /api to production. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = "/home/user/MorshLive";
const TYPES = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8", ".jpg":"image/jpeg", ".png":"image/png", ".svg":"image/svg+xml", ".webp":"image/webp" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path = decodeURIComponent(url.pathname);
  try {
    if (path.startsWith("/api/") || path.startsWith("/wk/")) {
      try {
        const up = await fetch(`https://korazero.com${path}${url.search}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
        const buf = Buffer.from(await up.arrayBuffer());
        res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/json" });
        return res.end(buf);
      } catch { res.writeHead(504, {"content-type":"application/json"}); return res.end('{"ok":false}'); }
    }
    if (path === "/") path = "/index.html";
    if (path === "/watch") path = "/watch.html";
    const body = await readFile(join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, "")));
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404).end("nf"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
for (const host of ["**fonts.googleapis.com/**","**fonts.gstatic.com/**","**espncdn.com/**","**google.com/**","**googletagmanager.com/**","**google-analytics.com/**","**cdn.jsdelivr.net/**"]) {
  await page.route(host, (r) => r.abort());
}
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(Number(process.env.WAIT || 20000));

const out = await page.evaluate(() => {
  const golden = [...document.querySelectorAll(".watch-source-toggle__opt--premium")];
  const autoToggles = [...document.querySelectorAll(".iptv-auto-toggle")];
  const links = [...document.querySelectorAll('a[href*="watch"]')].map((a) => a.getAttribute("href"));
  return {
    goldenCount: golden.length,
    autoToggleCount: autoToggles.length,
    goldenHrefs: golden.slice(0, 6).map((a) => a.getAttribute("href")),
    xtreamLinks: links.filter((h) => /source=xtream/.test(h || "")).length,
    totalWatchLinks: links.length,
    sampleLinks: links.slice(0, 5),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
