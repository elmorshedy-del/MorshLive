#!/usr/bin/env node
/**
 * Probe canonical Twitch resolution on the worker.
 * Usage: node scripts/probe-twitch-resolve.js [origin] [slot]
 */
const origin = process.argv[2] || "https://korazero.com";
const slot = process.argv[3] || "vip1";

(async () => {
  const apiUrl = `${origin}/api/twitch?slot=${encodeURIComponent(slot)}`;
  console.log("GET", apiUrl);
  const res = await fetch(apiUrl, { headers: { Accept: "application/json" } });
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));

  const vipUrl = `${origin}/wk/albaplayer/${slot}/?ch=bein-sports-1&serv=1`;
  console.log("\nHEAD", vipUrl);
  const vip = await fetch(vipUrl, { method: "HEAD" });
  console.log("status", vip.status);
  for (const [k, v] of vip.headers) {
    if (k.startsWith("x-kz")) console.log(k + ":", v);
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
