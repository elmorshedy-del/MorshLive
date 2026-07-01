import worker from "../worker.js";

const servs = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const SERVERS = servs.length ? servs : [1, 3];
const env = {
  STREAM_SIGNING_SECRET: "local-verify-secret",
  ASSETS: { fetch: () => new Response("not found", { status: 404 }) },
};

function decodedPlayerSources(html) {
  const out = [];
  for (const m of html.matchAll(/AlbaPlayerControl\('([^']+)'/g)) {
    try {
      out.push(atob(m[1]));
    } catch {
      // Ignore malformed upstream player calls.
    }
  }
  for (const m of html.matchAll(/["'](https?:\/\/[^"']+\/wk\/stream\.m3u8\?u=[^"']+)["']/g)) {
    out.push(m[1].replaceAll("&amp;", "&"));
  }
  return Array.from(new Set(out));
}

async function verifyServ(serv) {
  const pageUrl = `https://example.com/wk/albaplayer/vip1/?serv=${serv}`;
  const page = await worker.fetch(new Request(pageUrl, { headers: { "User-Agent": "Mozilla/5.0" } }), env);
  const html = await page.text();
  const sources = decodedPlayerSources(html);
  if (page.status !== 200 || !sources.length) {
    throw new Error(`بث ${serv}: no resolved stream source (page status ${page.status})`);
  }

  const src = sources[0];
  const target = new URL(src).searchParams.get("u");
  const manifest = await worker.fetch(new Request(src, { headers: { "User-Agent": "Mozilla/5.0" } }), env);
  const text = await manifest.text();
  const firstLine = text.split("\n")[0];
  if (manifest.status !== 200 || firstLine !== "#EXTM3U") {
    throw new Error(`بث ${serv}: manifest failed (${manifest.status} ${firstLine})`);
  }

  return { serv, target, manifestStatus: manifest.status, firstLine };
}

const results = [];
for (const serv of SERVERS) {
  results.push(await verifyServ(serv));
}

const targets = new Set(results.map((r) => r.target));
if (targets.size !== results.length) {
  throw new Error(`Expected unique stream targets, got ${Array.from(targets).join(", ")}`);
}

for (const result of results) {
  console.log(
    `✓ بث ${result.serv}: ${result.target} (${result.manifestStatus} ${result.firstLine})`
  );
}
