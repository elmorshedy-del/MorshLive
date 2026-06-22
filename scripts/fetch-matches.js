#!/usr/bin/env node
/* ============================================================================
 * scripts/fetch-matches.js
 * ----------------------------------------------------------------------------
 * Pulls REAL football fixtures for a given day from TheSportsDB (free API) and
 * writes them to assets/data/today.json in the shape the site expects.
 *
 * Usage:  node scripts/fetch-matches.js [YYYY-MM-DD]
 * Default date = today (UTC). No API key required (free test key "3").
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const https = require("https");

const KEY = process.env.SPORTSDB_KEY || "3"; // free public test key
const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const OUT = path.join(__dirname, "..", "assets", "data", "today.json");

const LIVE = ["1H", "2H", "HT", "ET", "BT", "P", "LIVE"];
const ENDED = ["FT", "AET", "PEN", "Match Finished", "AWD", "WO"];

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

function abbr(name) {
  return (name || "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function statusOf(s) {
  if (!s || s === "NS" || /not started/i.test(s)) return "upcoming";
  if (ENDED.includes(s)) return "ended";
  if (LIVE.includes(s) || /^\d+$/.test(s) || /'/.test(s)) return "live";
  return "upcoming";
}

(async () => {
  const url = `https://www.thesportsdb.com/api/v1/json/${KEY}/eventsday.php?d=${date}&s=Soccer`;
  const json = await get(url);
  const events = (json && json.events) || [];

  const matches = events.map((e) => {
    const status = statusOf(e.strStatus);
    const hs = e.intHomeScore, as = e.intAwayScore;
    const hasScore = hs != null && hs !== "" && as != null && as !== "";
    const time = (e.strTime || "").slice(0, 5) || "—";
    return {
      id: "e" + e.idEvent,
      status,
      minute: status === "live" ? (e.strProgress || e.strStatus || "مباشر") : "",
      home: e.strHomeTeam,
      away: e.strAwayTeam,
      homeAbbr: abbr(e.strHomeTeam),
      awayAbbr: abbr(e.strAwayTeam),
      homeBadge: e.strHomeTeamBadge || "",
      awayBadge: e.strAwayTeamBadge || "",
      score: hasScore ? `${hs} - ${as}` : (status === "ended" ? "0 - 0" : "VS"),
      time,
      league: e.strLeague || "مباراة",
      venue: [e.strVenue, e.strCity].filter(Boolean).join(" · "),
      channel: null,                 // real broadcaster unknown via this feed
      channelId: "bein-sports-1",    // route the watch button to the embed player
      commentator: null,             // no auto-fetchable source publishes this
    };
  });

  // Sort: live first, then upcoming (by time), then ended.
  const order = { live: 0, upcoming: 1, ended: 2 };
  matches.sort((a, b) => (order[a.status] - order[b.status]) || a.time.localeCompare(b.time));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify({ date, updatedAt: new Date().toISOString(), matches }, null, 2)
  );
  console.log(`Wrote ${matches.length} matches for ${date} -> ${path.relative(process.cwd(), OUT)}`);
})().catch((err) => {
  console.error("fetch-matches failed:", err.message);
  process.exit(1);
});
