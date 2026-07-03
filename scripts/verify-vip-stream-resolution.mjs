// Verifies the Worker actively resolves VIP slots to a live HLS stream at
// request time. Run: node scripts/verify-vip-stream-resolution.mjs [serv...]
// Exits non-zero if any requested server does not deliver a live #EXTM3U stream.
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
  for (const m of html.matchAll(/AlbaPlayerControl\('([^']+)'/g)) {
    try {
      out.push(atob(m[1]));
    } catch {
      // ignore malformed player calls
    }
  }
  for (const m of html.matchAll(/["'](https?:\/\/[^"']+\/wk\/stream\.m3u8\?u=[^"']+)["']/g)) {
    out.push(m[1].replaceAll("&amp;", "&"));
  }
  return Array.from(new Set(out));
}

async function verifyServer(serv) {
  const pageUrl = `https://example.com/wk/albaplayer/${SLOT}/?serv=${serv}`;
  const page = await worker.fetch(new Request(pageUrl, { headers: { "User-Agent": "Mozilla/5.0" } }), env);
  const html = await page.text();
  if (page.status !== 200) {
    throw new Error(`بث ${serv}: page status ${page.status}`);
  }
  if (/player\.twitch\.tv/i.test(html)) {
    return { serv, target: "(twitch embed)", servedBy: page.headers.get("X-KZ-Serv") };
  }
  if (/AlbaPlayerControl\s*\(/i.test(html)) {
    return { serv, target: "(upstream player)", servedBy: page.headers.get("X-KZ-Serv") };
  }
  const sources = proxiedSources(html);
  if (!sources.length) {
    return { serv, target: "(no player — upstream blank)", servedBy: page.headers.get("X-KZ-Serv") };
  }
  const src = sources[0];
  const target = new URL(src).searchParams.get("u");
  const manifest = await worker.fetch(new Request(src, { headers: { "User-Agent": "Mozilla/5.0" } }), env);
  const text = await manifest.text();
  const firstLine = text.split("\n")[0];
  if (manifest.status !== 200 || firstLine !== "#EXTM3U") {
    throw new Error(`بث ${serv}: manifest not live (${manifest.status} ${firstLine})`);
  }
  return { serv, target, servedBy: page.headers.get("X-KZ-Serv") };
}

const results = [];
for (const serv of SERVERS) {
  results.push(await verifyServer(serv));
}

for (const r of results) {
  console.log(`✓ بث ${r.serv}: ${r.target} (served by بث ${r.servedBy})`);
}

const uniqueTargets = new Set(results.map((r) => r.target));
console.log(`\nAll ${results.length} requested server(s) delivered a live stream. Unique streams: ${uniqueTargets.size}.`);
