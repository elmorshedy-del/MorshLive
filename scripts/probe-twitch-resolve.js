#!/usr/bin/env node
/**
 * Probe canonical Twitch resolution on the worker.
 * Usage: node scripts/probe-twitch-resolve.js [origin] [slot] [channelId] [matchId]
 */
const origin = process.argv[2] || "https://korazero.com";
const slot = process.argv[3] || "vip1";
const channelId = process.argv[4] || "bein-max-1";
const matchId = process.argv[5] || "";

(async () => {
  const qs = new URLSearchParams({ slot, ch: channelId });
  if (matchId) qs.set("match", matchId);
  const apiUrl = `${origin}/api/twitch?${qs}`;
  console.log("GET", apiUrl);
  const res = await fetch(apiUrl, { headers: { Accept: "application/json" } });
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));

  const vipQs = new URLSearchParams({ ch: channelId, serv: "1" });
  if (matchId) vipQs.set("match", matchId);
  const vipUrl = `${origin}/wk/albaplayer/${slot}/?${vipQs}`;
  console.log("\nHEAD", vipUrl);
  const vip = await fetch(vipUrl, { method: "HEAD" });
  console.log("status", vip.status);
  for (const [k, v] of vip.headers) {
    if (k.startsWith("x-kz")) console.log(k + ":", v);
  }

  if (body.match) {
    console.log("\nMatch:", `${body.match.home} vs ${body.match.away}`, body.match.channel ? `(${body.match.channel})` : "");
  }
  if (Array.isArray(body.statuses)) {
    const live = body.statuses.filter((s) => s.live).slice(0, 5);
    if (live.length) {
      console.log("Pure-TV live candidates:");
      for (const row of live) {
        console.log(`  ${row.login} [${row.game || "?"}] score=${row.titleScore} — ${row.title || ""}`);
      }
    }
  }

  if (!body.helix) {
    console.warn("\n⚠ TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not set — only upstream-scraped channels are used.");
  }
  if (!body.resolved) {
    console.warn("⚠ No live Twitch channel resolved for slot", slot);
    process.exit(1);
  }
  console.log("\n✓ Resolved Twitch:", body.resolved);
})();
