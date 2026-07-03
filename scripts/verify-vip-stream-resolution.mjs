// Verifies the Worker actively resolves VIP slots to the clean mirror player at
// request time. Run: node scripts/verify-vip-stream-resolution.mjs [serv...]
import worker from "../worker.js";

const requested = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const SERVERS = requested.length ? requested : [1, 2, 3];
const SLOT = "vip1";
const env = {
  STREAM_SIGNING_SECRET: "local-verify-secret",
  ASSETS: { fetch: () => new Response("not found", { status: 404 }) },
};

function proxiedSources(html) {
  const out = [];
  const kz = html.match(/\bdata-kz-src=(["'])([^"']+)\1/);
  if (kz) out.push(kz[2].replaceAll("&amp;", "&"));
  const list = html.match(/sources=(\[[^\]]+\])/);
  if (list) {
    try {
      for (const u of JSON.parse(list[1])) if (u) out.push(String(u).replaceAll("&amp;", "&"));
    } catch {
      // ignore malformed JSON
    }
  }
  for (const m of html.matchAll(/["'](https?:\/\/[^"']+\/(?:wk|dl)\/(?:stream\.m3u8|hls)\?u=[^"']+)["']/g)) {
    out.push(m[1].replaceAll("&amp;", "&"));
  }
  return Array.from(new Set(out));
}

async function verifyServer(serv) {
  const pageUrl = `https://example.com/wk/albaplayer/${SLOT}/?serv=${serv}&ch=bein-sports-1`;
  const page = await worker.fetch(new Request(pageUrl, { headers: { "User-Agent": "Mozilla/5.0" } }), env);
  const html = await page.text();
  const sources = proxiedSources(html);
  const mirrors = Number(page.headers.get("X-KZ-Mirrors") || 0);
  if (page.status !== 200 || !sources.length) {
    throw new Error(`بث ${serv}: no mirror player (status ${page.status}, mirrors ${mirrors})`);
  }
  if (!/\bdata-kz-src=/.test(html)) {
    throw new Error(`بث ${serv}: fell back to upstream player instead of clean HLS player`);
  }
  const src = sources[0];
  const target = new URL(src, "https://example.com").searchParams.get("u");
  const manifest = await worker.fetch(new Request(src, { headers: { "User-Agent": "Mozilla/5.0" } }), env);
  const text = await manifest.text();
  const firstLine = text.split("\n")[0];
  if (manifest.status !== 200 || firstLine !== "#EXTM3U") {
    throw new Error(`بث ${serv}: manifest not live (${manifest.status} ${firstLine.slice(0, 40)})`);
  }
  return { serv, target, mirrors: mirrors || sources.length, servedBy: page.headers.get("X-KZ-Serv") };
}

const results = [];
for (const serv of SERVERS) {
  results.push(await verifyServer(serv));
}

for (const r of results) {
  console.log(`✓ بث ${r.serv}: ${r.target} (${r.mirrors} mirror(s), served by بث ${r.servedBy || "pool"})`);
}

const uniqueTargets = new Set(results.map((r) => r.target));
console.log(`\nAll ${results.length} requested server(s) use the clean mirror player. Unique streams: ${uniqueTargets.size}.`);
