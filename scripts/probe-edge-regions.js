#!/usr/bin/env node
/**
 * Probe korazero.com edge + key assets from current network (Cloudflare colo/country).
 * Usage: node scripts/probe-edge-regions.js [baseUrl]
 */
const BASE = (process.argv[2] || "https://korazero.com").replace(/\/$/, "");

const PATHS = [
  "/api/edge",
  "/assets/data/highlights-banners.json",
  "/assets/data/today.json",
  "/",
  "/watch.html",
];

async function probe(path) {
  const url = `${BASE}${path}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { Accept: "*/*" }, redirect: "follow" });
    const ms = Date.now() - t0;
    const cc = res.headers.get("cf-ray") || "";
    const cache = res.headers.get("cache-control") || "";
    let body = null;
    if (path.endsWith(".json") || path.startsWith("/api/")) {
      try { body = await res.json(); } catch { body = null; }
    }
    return { path, ok: res.ok, status: res.status, ms, cache, cfRay: cc, body };
  } catch (err) {
    return { path, ok: false, status: 0, ms: Date.now() - t0, error: err.message };
  }
}

(async () => {
  console.log(`Probing ${BASE} …\n`);
  const results = await Promise.all(PATHS.map(probe));
  for (const r of results) {
    console.log(`${r.ok ? "OK" : "FAIL"} ${r.status} ${r.ms}ms ${r.path}`);
    if (r.cache) console.log(`   cache-control: ${r.cache}`);
    if (r.cfRay) console.log(`   cf-ray: ${r.cfRay}`);
    if (r.body && r.path === "/api/edge") {
      console.log(`   edge: country=${r.body.country} colo=${r.body.colo} city=${r.body.city}`);
    }
    if (r.body && r.path.includes("highlights-banners")) {
      console.log(`   banner days: ${(r.body.days || []).length}`);
    }
    if (r.error) console.log(`   error: ${r.error}`);
  }
  const edge = results.find((r) => r.path === "/api/edge");
  if (edge?.body?.country) {
    const gcc = new Set(["SA", "AE", "QA", "KW", "BH", "OM"]);
    const mena = gcc.has(edge.body.country) || edge.body.country === "EG";
    console.log(`\nRegion hint: ${mena ? "MENA/GCC-friendly edge" : "non-MENA probe point"} (${edge.body.country})`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
