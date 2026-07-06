#!/usr/bin/env node
/**
 * Probe korazero /dl/{id} embed pages and /api/streams-lab for catalog health.
 * Use when dlhd.pk is blocked locally (datacenter IP).
 *
 * Run: node scripts/sync-streams-lab-catalog.mjs [origin]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const origin = process.argv[2] || process.env.KZ_ORIGIN || "https://korazero.com";
const catalogPath = join(dirname(fileURLToPath(import.meta.url)), "../assets/data/streams-lab.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

async function probeDl(id) {
  try {
    const r = await fetch(`${origin}/dl/${id}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(18_000),
    });
    const t = await r.text();
    const ok = r.ok && (/\/dl\/hls\?/.test(t) || t.includes("hls.js"));
    return { ok, status: r.status };
  } catch (e) {
    return { ok: false, err: String(e.message || e) };
  }
}

console.log("Streams lab sync —", origin, new Date().toISOString(), "\n");

const dl = (catalog.channels || []).filter((c) => c.dlhdId);
let live = 0;
for (const ch of dl) {
  const p = await probeDl(ch.dlhdId);
  if (p.ok) live++;
  console.log(`${p.ok ? "✓" : "✗"} ${ch.dlhdId} ${ch.name} [${p.status || p.err || "—"}]`);
}

console.log(`\nEmbed probe: ${live}/${dl.length} live via ${origin}/dl/{id}`);

const api = await fetch(`${origin}/api/streams-lab`, { headers: { Accept: "application/json" } });
const data = await api.json();
console.log(`API probe: ${data.liveCount}/${data.total} live (best: ${data.best?.name || "—"})`);

if (!data.ok) process.exit(1);
