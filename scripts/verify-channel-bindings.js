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
const {
  loadBindings,
  buildLiveSnapshot,
  writeLiveSnapshot,
  probeVipSlots,
  assignMatchEmbeds,
} = require("./channel-bindings-lib");

const TODAY = path.join(__dirname, "..", "assets", "data", "today.json");

async function main() {
  const payload = JSON.parse(fs.readFileSync(TODAY, "utf8"));
  const matches = payload.matches || [];
  const bindings = loadBindings();
  const slotProbe = bindings.vipSlotProbe || (await probeVipSlots());
  assignMatchEmbeds(matches, slotProbe, bindings.embedBinding);
  const snapshot = writeLiveSnapshot(matches, { ...bindings, vipSlotProbe: slotProbe });

  console.log(`Binding version: ${bindings.version}`);
  console.log(`Vip slot probe: ${JSON.stringify(slotProbe.slots)}`);
  console.log(`Live matches: ${snapshot.liveCount}`);
  snapshot.routes.forEach((r) => {
    const upstream = r.embedUpstream ? ` (${r.embedUpstream})` : "";
    console.log(`  ${r.home} vs ${r.away} → ${r.channelId} → ${r.embedKey}${upstream}`);
  });

  const france = matches.find((m) => m.id === "e2391775");
  if (france) {
    console.log(`\nFrance vs Norway: channel=${france.channelId}, embedKey=${france.embedKey}, upstream=${france.embedUpstream || "?"}`);
  }

  if (snapshot.conflicts.length) {
    console.error("\n❌ Embed conflicts detected:");
    snapshot.conflicts.forEach((c) => {
      console.error(`  ${c.embed}: ${c.games.join(" | ")}`);
    });
    console.error("\nConcurrent live matches share a vip feed — check probe results and match embedKey.");
    process.exit(1);
  }

  console.log("\n✓ No embed conflicts among live matches.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
