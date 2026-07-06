#!/usr/bin/env node
/**
 * Query backend stream watchdog by incident time.
 *
 * Usage:
 *   node scripts/query-stream-log.mjs "2026-07-05T23:14:30Z"
 *   node scripts/query-stream-log.mjs "2026-07-05T23:14:30Z" 180
 *   node scripts/query-stream-log.mjs --recent
 *
 * Env: SITE_URL=https://korazero.com
 */
const SITE = (process.env.SITE_URL || "https://korazero.com").replace(/\/$/, "");
const at = process.argv[2];
const windowSec = Number(process.argv[3] || 120);

async function main() {
  let url;
  if (at === "--recent" || !at) {
    url = `${SITE}/api/stream-log?limit=30`;
  } else {
    url = `${SITE}/api/stream-log?at=${encodeURIComponent(at)}&window=${windowSec}&limit=200`;
  }

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    console.error("HTTP", res.status, data);
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
  if (data.incidents && data.incidents.length) {
    console.error(`\n${data.count} event(s) in window (of ${data.totalStored} stored)`);
  } else {
    console.error("\nNo events in that window — try wider window or check totalStored.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
