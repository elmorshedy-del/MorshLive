#!/usr/bin/env node
/**
 * Probe known 24/7 stream sources (dlhd.pk beIN Sports / MAX) for liveness.
 * Run: node scripts/probe-stream-sources.mjs
 */
const DLHD_BASE = "https://dlhd.pk";
const HEADERS = { "User-Agent": "Mozilla/5.0", Referer: `${DLHD_BASE}/` };

const CHANNELS = {
  "bein-sports-1": [91, "beIN Sports 1 Arabic"],
  "bein-sports-2": [92, "beIN Sports 2 Arabic"],
  "bein-sports-3": [93, "beIN Sports 3 Arabic"],
  "bein-sports-4": [94, "beIN Sports 4 Arabic"],
  "bein-max-1": [597, "beIN SPORTS MAX AR", 91],
  "bein-max-2": [597, "beIN SPORTS MAX AR", 92],
  "bein-max-3": [597, "beIN SPORTS MAX AR", 94],
  "bein-max-4": [597, "beIN SPORTS MAX AR", 95],
};

async function resolveDl(id) {
  try {
    const sTxt = await (await fetch(`${DLHD_BASE}/stream/stream-${id}.php`, { headers: HEADERS })).text();
    const embed = sTxt.match(/<iframe[^>]+src="([^"]+\/premiumtv\/[^"]+)"/i);
    if (!embed) return null;
    const eTxt = await (await fetch(embed[1], { headers: HEADERS })).text();
    const b64 = eTxt.match(/atob\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)/);
    if (!b64) return null;
    return Buffer.from(b64[1], "base64").toString("utf8");
  } catch {
    return null;
  }
}

async function probeMaster(url) {
  try {
    const r = await fetch(url, { headers: { ...HEADERS, Referer: undefined, Origin: undefined } });
    const t = await r.text();
    const live = r.ok && t.trimStart().startsWith("#EXTM3U");
    const host = new URL(url).hostname;
    return { status: r.status, live, host };
  } catch (e) {
    return { status: "err", live: false, err: String(e) };
  }
}

async function probeId(id, label) {
  const url = await resolveDl(id);
  if (!url) return { id, label, ok: false, reason: "resolve failed" };
  const p = await probeMaster(url);
  return { id, label, ok: p.live, ...p, url: url.split("?")[0] };
}

console.log("dlhd.pk 24/7 beIN probe —", new Date().toISOString(), "\n");

const seen = new Set();
for (const [chId, spec] of Object.entries(CHANNELS)) {
  const ids = [...new Set(spec.filter((x) => typeof x === "number"))];
  const labels = spec.filter((x) => typeof x === "string");
  console.log(`## ${chId}`);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const label = labels[i] || labels[0] || `id ${id}`;
    const key = `${id}`;
    if (seen.has(key)) {
      console.log(`  dlhd ${id} (${label}) — same as above`);
      continue;
    }
    seen.add(key);
    const r = await probeId(id, label);
    const mark = r.ok ? "✓ LIVE" : "✗ dead";
    console.log(`  dlhd ${id} (${label}) — ${mark} [${r.status}] ${r.host || r.reason || ""}`);
  }
  console.log("");
}

console.log("Notes:");
console.log("- Arabic beIN MAX 1–4 have no separate dlhd entries; only MAX AR (597).");
console.log("- worldkoora vip1/vip2 remain primary for live MAX match feeds.");
console.log("- Add direct m3u8 URLs to EXTRA_CHANNEL_STREAMS in worker.js when found.");
