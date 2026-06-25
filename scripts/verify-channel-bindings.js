#!/usr/bin/env node
/* ============================================================================
 * verify-channel-bindings.js — Sanity-check live match → embed routing.
 *
 * Usage:  node scripts/verify-channel-bindings.js
 * Reads:  assets/data/today.json, assets/data/channel-bindings.json
 * Writes: assets/data/live-snapshot.json (refreshed)
 * Exit 1 if multiple LIVE matches at the same kickoff map to the same embed.
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const { loadBindings, buildLiveSnapshot, writeLiveSnapshot } = require("./channel-bindings-lib");

const TODAY = path.join(__dirname, "..", "assets", "data", "today.json");

function main() {
  const matches = JSON.parse(fs.readFileSync(TODAY, "utf8")).matches || [];
  const bindings = loadBindings();
  const snapshot = writeLiveSnapshot(matches);

  console.log(`Binding version: ${bindings.version}`);
  console.log(`Live matches: ${snapshot.liveCount}`);
  snapshot.routes.forEach((r) => {
    console.log(`  ${r.home} vs ${r.away} → ${r.channelId} → ${r.embedKey}`);
  });

  if (snapshot.conflicts.length) {
    console.error("\n❌ Embed conflicts detected:");
    snapshot.conflicts.forEach((c) => {
      console.error(`  ${c.embed}: ${c.games.join(" | ")}`);
    });
    console.error("\nFix assets/data/channel-bindings.json and document in calibration[].");
    process.exit(1);
  }

  console.log("\n✓ No embed conflicts among live matches.");
}

main();
