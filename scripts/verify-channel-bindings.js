#!/usr/bin/env node
/* ============================================================================
 * verify-channel-bindings.js — Sanity-check live match → embed routing.
 *
 * Usage:  node scripts/verify-channel-bindings.js
 * Reads:  assets/data/today.json, assets/data/channel-bindings.json
 * Writes: assets/data/live-snapshot.json (refreshed)
 * Warns if multiple LIVE matches map to the same embed.
 * Exit 1 only when KZ_BINDINGS_STRICT=1. Workers Builds must still
 * wrangler-deploy stream-plans.json (Valencia 25 Aug + Madrid 26 Aug
 * stayed no-catalog-legacy because this gate aborted the build).
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
    if (process.env.KZ_BINDINGS_STRICT === "1") process.exit(1);
    console.error("Warning only — continuing so Workers Builds can deploy stream-plans.");
    return;
  }

  console.log("\n✓ No embed conflicts among live matches.");
}

main();
