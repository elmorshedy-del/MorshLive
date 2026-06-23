#!/usr/bin/env node
/* ============================================================================
 * fetch-matches.js — Pulls fixtures from TheSportsDB (free open API).
 * Writes assets/data/today.json as offline cache / GitHub Pages fallback.
 *
 * Usage:  node scripts/fetch-matches.js [YYYY-MM-DD]
 * Env:    SPORTSDB_KEY (optional, default "3")
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const https = require("https");
const { normalizeEvent, sortMatches } = require("./matches-lib");

const KEY = process.env.SPORTSDB_KEY || "3";
const centerDate = process.argv[2] || new Date().toISOString().slice(0, 10);
const OUT = path.join(__dirname, "..", "assets", "data", "today.json");

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "morsh-live/1.0" } }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
        });
      })
      .on("error", reject);
  });
}

function shiftDate(iso, days) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchDay(date) {
  const url = `https://www.thesportsdb.com/api/v1/json/${KEY}/eventsday.php?d=${date}&s=Soccer`;
  const json = await get(url);
  return Array.isArray(json.events) ? json.events : [];
}

(async () => {
  const dates = [shiftDate(centerDate, -1), centerDate, shiftDate(centerDate, 1)];
  const seen = new Set();
  const matches = [];

  for (const date of dates) {
    const events = await fetchDay(date);
    for (const e of events) {
      const id = "e" + e.idEvent;
      if (seen.has(id)) continue;
      seen.add(id);
      matches.push(normalizeEvent(e));
    }
  }

  sortMatches(matches);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        date: centerDate,
        updatedAt: new Date().toISOString(),
        source: "thesportsdb",
        sourceLabel: "TheSportsDB",
        matches,
      },
      null,
      2
    )
  );
  console.log(`Wrote ${matches.length} matches (${dates.join(", ")}) -> ${path.relative(process.cwd(), OUT)}`);
})().catch((err) => {
  console.error("fetch-matches failed:", err.message);
  process.exit(1);
});
