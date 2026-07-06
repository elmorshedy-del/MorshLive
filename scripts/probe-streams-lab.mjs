#!/usr/bin/env node
/** Probe /api/streams-lab on production or local. */
const origin = process.argv[2] || process.env.KZ_ORIGIN || "https://korazero.com";

const res = await fetch(`${origin}/api/streams-lab`, { headers: { Accept: "application/json" } });
const data = await res.json();
console.log("GET", `${origin}/api/streams-lab`, res.status);
console.log(`Live: ${data.liveCount}/${data.total}`);
if (data.best) console.log("Best:", data.best.name, "→", data.best.route);
console.log("\nChannels:");
for (const ch of data.channels || []) {
  console.log(`  ${ch.live ? "✓" : "✗"} ${ch.name} → ${ch.route}${ch.mirror ? " (mirror)" : ""}`);
}
if (!data.ok) process.exit(1);
