#!/usr/bin/env node
/**
 * Discover + probe all dlhd.pk beIN 24/7 channels.
 * Run: node scripts/probe-dlhd-bein.mjs
 */
const DLHD = "https://dlhd.pk";
const HEADERS = { "User-Agent": "Mozilla/5.0", Referer: `${DLHD}/` };

async function resolveId(id) {
  try {
    const sTxt = await (await fetch(`${DLHD}/stream/stream-${id}.php`, { headers: HEADERS })).text();
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
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const t = await r.text();
    return r.ok && t.trimStart().startsWith("#EXTM3U");
  } catch {
    return false;
  }
}

const html = await (await fetch(`${DLHD}/24-7-channels.php`, { headers: HEADERS })).text();
const entries = [...html.matchAll(/watch\.php\?id=(\d+)[^>]*data-title="([^"]+)"/gi)];
const bein = entries
  .map((m) => ({ id: Number(m[1]), name: m[2].trim() }))
  .filter((e) => /bein/i.test(e.name));

const seen = new Set();
const uniq = [];
for (const e of bein) {
  if (seen.has(e.id)) continue;
  seen.add(e.id);
  uniq.push(e);
}

console.log(`Probing ${uniq.length} dlhd beIN channels…\n`);
const out = [];
for (const ch of uniq) {
  const url = await resolveId(ch.id);
  const live = url ? await probeMaster(url) : false;
  const row = { id: ch.id, name: ch.name, live, route: `/dl/${ch.id}`, source: "dlhd" };
  out.push(row);
  console.log(`${live ? "✓" : "✗"} ${ch.id} ${ch.name}`);
}

const live = out.filter((r) => r.live);
console.log(`\n${live.length}/${out.length} live`);
console.log(JSON.stringify({ updatedAt: new Date().toISOString(), channels: out }, null, 2));
