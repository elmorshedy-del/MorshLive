#!/usr/bin/env node
/**
 * Probe SIR / foozlive / shootny sources for experimental bein-sir.html.
 * Run: node scripts/probe-sir-sources.mjs
 */
import { createHash } from "node:crypto";

const SIR_PLAYERS = [
  { id: "siir-tv-live", url: "https://912acsss8af382.shootny.com/playerv5.php", key: "9f39972b67d6ce22189507d008acwc26", referer: "https://www.siir-tv.live/" },
  { id: "shootny-primary", url: "https://912acsss8af382.shootny.com/playerv5.php", key: "9f39972b67d6ce22189507d008acwc26", referer: "https://912acsss8af382.shootny.com/" },
  { id: "sir-tv-new", url: "https://912acsss8af382.shootny.com/playerv5.php", key: "9f39972b67d6ce22189507d008acwc26", referer: "https://sir-tv-new.me/" },
];
const SIR_XOR = "k9f2m7x1";
const PROBE_MATCH = "4748109";

function md5(s) {
  return createHash("md5").update(s).digest("hex");
}

function sirRand(n, set) {
  let s = "";
  for (let i = 0; i < n; i++) s += set[Math.floor(Math.random() * set.length)];
  return s;
}
function sirB36(n) {
  const d = "0123456789abcdefghijklmnopqrstuvwxyz";
  let s = "";
  while (n) { s = d[n % 36] + s; n = Math.floor(n / 36); }
  return s || "0";
}
function sirRewritePath(path) {
  let p = path.startsWith("/") ? path.slice(1) : path;
  let q = p.startsWith("kooora/") ? p.slice(7) : p;
  if (q.startsWith("kc/")) return `kooora/${q.slice(3)}_kc`;
  if (q.startsWith("sc/")) return `kooora/${q.slice(3)}_sc`;
  if (q.startsWith("mx/")) return `kooora/${q.slice(3)}_mux`;
  if (q.startsWith("loco/")) return `kooora/${q.slice(5)}_loco`;
  return p;
}
function sirSign(domain, real, secret) {
  const sid = sirRand(32, "0123456789abcdef");
  const ts = Math.floor(Date.now() / 1000);
  const token = md5(real + sid + secret);
  const nonce = sirRand(4, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") + sirB36(ts % 100000);
  return `${domain}${real}?ts=${ts}&nonce=${nonce}&token=${token}&sid=${sid}`;
}

function decodeConfig(html) {
  const m = html.match(/var _0x="([^"]+)"/);
  const e = html.match(/var _e="([^"]+)"/);
  if (!m || !e) return null;
  try {
    const bin = Buffer.from(m[1], "base64");
    const bytes = Buffer.alloc(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin[i] ^ SIR_XOR.charCodeAt(i % SIR_XOR.length);
    const cfg = JSON.parse(bytes.toString("utf8"));
    return { cfg, secret: Buffer.from(e[1], "base64").toString("utf8") };
  } catch {
    return null;
  }
}

async function probeMaster(url, referer, origin) {
  try {
    const headers = { "User-Agent": "Mozilla/5.0", Accept: "*/*", Referer: referer };
    if (origin) headers.Origin = origin;
    const r = await fetch(url, { headers, redirect: "follow" });
    const t = await r.text();
    const live = r.ok && t.trimStart().startsWith("#EXTM3U");
    return { status: r.status, live, host: new URL(url).hostname };
  } catch (e) {
    return { status: "err", live: false, err: String(e) };
  }
}

async function probePlayer(player) {
  const res = await fetch(`${player.url}?match=${PROBE_MATCH}&key=${player.key}`, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html", Referer: player.referer },
    redirect: "follow",
  });
  if (!res.ok) return { player: player.id, ok: false, reason: `HTTP ${res.status}` };
  const html = await res.text();
  const decoded = decodeConfig(html);
  if (!decoded) return { player: player.id, ok: false, reason: "config decode failed" };
  const { cfg, secret } = decoded;
  const domains = cfg.activeDomains?.length ? cfg.activeDomains : ["https://1rxolmirvosixpyfy.foozlive.co/"];
  const tabs = (cfg.tabs || []).filter((t) => t.type === "regular" && t.path);
  const results = [];
  for (const tab of tabs) {
    const domain = domains[0].endsWith("/") ? domains[0] : `${domains[0]}/`;
    const master = sirSign(domain, sirRewritePath(tab.path), secret);
    const probe = await probeMaster(master, player.referer, "https://912acsss8af382.shootny.com");
    results.push({
      label: tab.label || tab.path,
      path: tab.path,
      live: probe.live,
      status: probe.status,
      host: probe.host,
    });
  }
  return { player: player.id, ok: true, domains, tabs: results };
}

console.log("SIR / foozlive probe —", new Date().toISOString(), "\n");

for (const player of SIR_PLAYERS) {
  const r = await probePlayer(player);
  console.log(`## ${player.id}`);
  if (!r.ok) {
    console.log(`  ✗ ${r.reason}\n`);
    continue;
  }
  console.log(`  domains: ${r.domains.join(", ")}`);
  for (const tab of r.tabs) {
    const mark = tab.live ? "✓ LIVE" : "✗ dead";
    console.log(`  ${mark}  ${tab.label}  [${tab.status}] ${tab.host || ""}`);
    console.log(`         path: ${tab.path}`);
  }
  console.log("");
}

const KZ = process.env.KZ_ORIGIN || "https://korazero.com";
console.log(`## korazero experimental routes (${KZ})`);
for (const slug of ["ar1", "ar2", "fr", "en"]) {
  try {
    const r = await fetch(`${KZ}/sir/${slug}`, { method: "HEAD" });
    const body = r.ok ? await (await fetch(`${KZ}/sir/${slug}`)).text() : "";
    const hasHls = /\/sir\/hls\?/.test(body);
    console.log(`  /sir/${slug} — HTTP ${r.status} ${hasHls ? "✓ player ready" : "✗ no stream"}`);
  } catch (e) {
    console.log(`  /sir/${slug} — err ${e.message}`);
  }
}
