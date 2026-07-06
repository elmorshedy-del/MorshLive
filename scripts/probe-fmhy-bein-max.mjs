#!/usr/bin/env node
/**
 * Probe FMHY-listed live sports sources for beIN MAX / Arabic beIN feeds.
 * Source list: https://fmhy.net/video (Live TV / Sports + Live Sports sections)
 *
 * Run: node scripts/probe-fmhy-bein-max.mjs
 */
const DLHD_BASE = "https://dlhd.pk";
const HEADERS = { "User-Agent": "Mozilla/5.0", Referer: `${DLHD_BASE}/` };

// FMHY ⭐ live sports aggregators (2026-07)
const FMHY_LIVE_SPORTS = [
  { name: "DaddyLive / dlhd.pk", url: `${DLHD_BASE}/24-7-channels.php`, kind: "dlhd-247" },
  { name: "Streamed.pk", url: "https://streamed.pk/api/matches/football", kind: "streamed-api" },
  { name: "StreamSports99", url: "https://streamsports99.ru/live-tv", kind: "html" },
  { name: "SportsBite", url: "https://sportsbite.lol/channels", kind: "html" },
  { name: "WatchSports", url: "https://watchsports.to/", kind: "html" },
  { name: "Score808", url: "https://score808hd.tv/", kind: "html" },
  { name: "NTV", url: "https://ntv.cx/", kind: "html" },
];

const DLHD_BEIN = {
  "beIN MAX AR (24/7)": 597,
  "beIN Sports 1 Arabic": 91,
  "beIN Sports 2 Arabic": 92,
  "beIN Sports 3 Arabic": 93,
  "beIN Sports 4 Arabic": 94,
  "beIN Sports 5 Arabic": 95,
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
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const t = await r.text();
    return { ok: r.ok && t.trimStart().startsWith("#EXTM3U"), status: r.status, host: new URL(url).hostname };
  } catch (e) {
    return { ok: false, status: "err", err: String(e) };
  }
}

async function probeDlhd() {
  console.log("## dlhd.pk 24/7 (FMHY ⭐ — already integrated in worker.js)\n");
  for (const [label, id] of Object.entries(DLHD_BEIN)) {
    const url = await resolveDl(id);
    if (!url) {
      console.log(`  ✗ ${label} (id ${id}) — resolve failed`);
      continue;
    }
    const p = await probeMaster(url);
    console.log(`  ${p.ok ? "✓" : "✗"} ${label} (id ${id}) — [${p.status}] ${p.host || ""}`);
  }
  console.log("");
}

async function probeStreamed() {
  console.log("## Streamed.pk (FMHY ⭐ — per-match aggregator)\n");
  try {
    const res = await fetch("https://streamed.pk/api/matches/football");
    const matches = await res.json();
    const popular = matches.filter((m) => m.popular).slice(0, 12);
    let arCount = 0;
    for (const m of popular) {
      for (const src of m.sources || []) {
        const sr = await fetch(`https://streamed.pk/api/stream/${src.source}/${src.id}`);
        if (!sr.ok) continue;
        const streams = await sr.json();
        for (const st of streams) {
          if (/arab|bein|max/i.test(st.language || "")) {
            console.log(`  • ${m.title} — ${st.language}`);
            console.log(`    ${st.embedUrl}`);
            arCount++;
          }
        }
      }
    }
    if (!arCount) {
      console.log("  No Arabic / beIN MAX streams on current popular football matches.");
      console.log("  (French beIN Sports 1 is common; Arabic MAX is rare here.)");
    }
  } catch (e) {
    console.log("  ✗ API error:", e.message);
  }
  console.log("");
}

async function probeHtmlSites() {
  console.log("## Other FMHY HTML aggregators (beIN keyword scan)\n");
  for (const site of FMHY_LIVE_SPORTS.filter((s) => s.kind === "html")) {
    try {
      const r = await fetch(site.url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
      const html = await r.text();
      const hits = [...html.matchAll(/bein[^<"']{0,70}/gi)]
        .map((m) => m[0].replace(/\s+/g, " ").trim())
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 5);
      console.log(`  ${site.name} [${r.status}] — ${hits.length ? hits.join(" | ") : "no beIN text found"}`);
    } catch (e) {
      console.log(`  ${site.name} — ✗ ${e.message}`);
    }
  }
  console.log("");
}

console.log("FMHY beIN MAX probe —", new Date().toISOString());
console.log("Index: https://fmhy.net/video → Live Sports\n");

await probeDlhd();
await probeStreamed();
await probeHtmlSites();

console.log("Notes:");
console.log("- FMHY does not list beIN MAX directly; use aggregators above.");
console.log("- Arabic beIN MAX 1–4 are NOT separate 24/7 dlhd ids — only MAX AR (597).");
console.log("- Best live Arabic MAX for World Cup: worldkoora/mysportv VIP (project primary).");
console.log("- FMHY-Downloader (GitHub) is VOD-only — not for live sports.");
console.log("- iptv-org public playlists have no beIN (geo/DMCA).");
