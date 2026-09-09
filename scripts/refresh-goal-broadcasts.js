#!/usr/bin/env node
/* ============================================================================
 * refresh-goal-broadcasts.js — Rebuild assets/data/broadcast-overrides.json
 * from goal.com's MENA listings.
 *
 * This file is machine-owned and rewritten whole on every run. That is the
 * point: hand-editing channel numbers into today.json collides with the
 * scheduled refresh, which rewrites commentaryIndex from almaghrebsport and
 * silently discards the correction. Overrides live in their own file, the
 * refresh applies them last, and a later run of this script replaces them
 * rather than merging into anything.
 *
 * Precedence, highest first:
 *   1. assets/data/manual-channel-overrides.json — hand-made, never generated
 *   2. assets/data/broadcast-overrides.json      — this file
 *   3. the almaghrebsport commentator feed        — refresh-broadcasts.js
 *
 * goal.com publishes a fixture's channel two to three days ahead, so a
 * seven-day run returns channels for the near days and nothing for the far
 * ones. Fixtures with no listing are written with no channel rather than a
 * guess, and picked up by a later run.
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const { fetchLeagueFixtures } = require("./refresh-broadcasts.js");
const { findGoalFixture, pickArabicBeinChannel } = require("./goal-broadcasts-lib.js");
const { isSaudiProLeagueMatch } = require("./broadcast-registry.js");

const OUT = path.join(__dirname, "..", "assets", "data", "broadcast-overrides.json");
const LEAGUES = ["eng.1", "esp.1", "uefa.champions", "uefa.champions_qual"];
const LOOKAHEAD_DAYS = 7;
const AR_MATCH_SEGMENT = encodeURIComponent("المباراة");
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  // goal.com scopes broadcast listings by visitor geography. Without a MENA
  // hint tvChannels comes back empty on every page, in every locale.
  "CF-IPCountry": "SA",
  "X-Forwarded-For": "188.55.0.1",
  "Accept-Language": "ar,en;q=0.8",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function arabiaTodayIso() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dayRange(from, days) {
  const out = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  for (let i = 0; i < days; i += 1) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

async function getText(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
      if (response.ok) return await response.text();
    } catch {
      /* fall through to the retry */
    }
    if (attempt < attempts) await sleep(1200 * attempt);
  }
  return "";
}

function nextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/* goal.com nests its fixture rows differently per page, so walk for the shape
   rather than a path: any node carrying a MATCH link and a start date. */
function collectFixtures(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const value of node) collectFixtures(value, out);
    return out;
  }
  if (node.link?.pageType === "MATCH" && node.startDate) {
    out.push({
      id: node.link.id,
      start: node.startDate,
      home: node.teamA?.name || null,
      away: node.teamB?.name || null,
    });
  }
  for (const key of Object.keys(node)) collectFixtures(node[key], out);
  return out;
}

function collectTvChannels(node) {
  let found = [];
  (function walk(value) {
    if (!value || typeof value !== "object" || found.length) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (Array.isArray(value.tvChannels) && value.tvChannels.length) {
      found = value.tvChannels.map((channel) => channel?.name).filter(Boolean);
      return;
    }
    for (const key of Object.keys(value)) walk(value[key]);
  })(node);
  return found;
}

async function ourFixtures(from) {
  const to = dayRange(from, LOOKAHEAD_DAYS).at(-1);
  const perLeague = await Promise.all(LEAGUES.map((slug) => fetchLeagueFixtures(slug, from)));
  return perLeague
    .flat()
    // Saudi fixtures are refresh-saudi-broadcasts.js's to own, and goal.com
    // does not carry Thmanyah's numbering. Leaving them out keeps the two
    // sources from ever disagreeing about the same fixture.
    .filter((match) => !isSaudiProLeagueMatch(match))
    .filter((match) => {
      const day = String(match.kickoffUtc || "").slice(0, 10);
      return day >= from && day <= to;
    })
    .sort((a, b) => String(a.kickoffUtc).localeCompare(String(b.kickoffUtc)));
}

async function goalListing(from) {
  const rows = new Map();
  for (const day of dayRange(from, LOOKAHEAD_DAYS)) {
    const html = await getText(`https://www.goal.com/en-ae/fixtures/${day}`);
    for (const row of collectFixtures(nextData(html) || {})) {
      if (row.id && !rows.has(row.id)) rows.set(row.id, row);
    }
    await sleep(600);
  }
  return [...rows.values()];
}

async function main() {
  const from = process.argv[2] || arabiaTodayIso();
  const fixtures = await ourFixtures(from);
  console.log(`goal.com refresh: ${fixtures.length} European fixtures from ${from} (+${LOOKAHEAD_DAYS}d)`);

  const listing = await goalListing(from);
  console.log(`goal.com listed ${listing.length} fixtures across the window`);

  const rows = {};
  let resolved = 0;
  let unlisted = 0;
  for (const fixture of fixtures) {
    const hit = findGoalFixture(fixture, listing);
    if (!hit) {
      unlisted += 1;
      continue;
    }
    const html = await getText(`https://www.goal.com/ar-sa/${AR_MATCH_SEGMENT}/x/${hit.id}`);
    const channel = pickArabicBeinChannel(collectTvChannels(nextData(html) || {}));
    if (channel) {
      resolved += 1;
      rows[fixture.id] = {
        ...channel,
        kickoffUtc: fixture.kickoffUtc,
        home: fixture.home,
        away: fixture.away,
        goalId: hit.id,
      };
      console.log(`  ${fixture.kickoffUtc.slice(5, 16)}  ${fixture.home} v ${fixture.away} -> ${channel.channel}`);
    }
    await sleep(600);
  }

  console.log(
    `goal.com refresh: ${resolved} channels resolved, ` +
      `${fixtures.length - resolved - unlisted} listed without a channel yet, ${unlisted} not listed`,
  );

  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch {
    /* first run, or a file we are about to replace anyway */
  }

  // Carry forward a channel this run could not see, as long as its fixture has
  // not kicked off yet.
  //
  // Writing only what one harvest returned makes every failure destructive:
  // goal.com refusing the geo hint, changing its markup, or rate-limiting all
  // produce zero rows, and zero rows would blank a file full of correct
  // assignments — sending every card back to the feed's beIN 1 guess with
  // nothing to alarm on, because the workflow treats a failed harvest as
  // non-fatal on purpose. A fresh answer still wins; only silence is refused.
  //
  // Rows are dropped once their kickoff has passed, so this stays self-cleaning
  // rather than accumulating a season of dead fixtures.
  const kept = {};
  const now = Date.now();
  for (const [id, row] of Object.entries(previous?.rows || {})) {
    if (rows[id]) continue;
    const kickoff = Date.parse(row?.kickoffUtc || "");
    if (Number.isFinite(kickoff) && kickoff > now) kept[id] = row;
  }
  if (Object.keys(kept).length) {
    console.log(`goal.com refresh: kept ${Object.keys(kept).length} previously resolved channels this run could not see`);
    Object.assign(rows, kept);
  }

  // A timestamp that moves on every run is a diff on every run, and the workflow
  // commits whatever differs — so an unconditional generatedAt would push and
  // rebuild the site every six hours whether or not a single channel changed.
  // Nothing downstream reads it; it exists to date the rows, so it only moves
  // when the rows do.
  const sortedRows = Object.fromEntries(Object.keys(rows).sort().map((id) => [id, rows[id]]));
  const unchanged = previous && JSON.stringify(previous.rows || {}) === JSON.stringify(sortedRows);
  if (unchanged) {
    console.log(`Overrides unchanged (${Object.keys(rows).length} rows); leaving the file alone`);
    return;
  }

  const payload = {
    source: "goal.com",
    note: "Machine-generated. Rewritten whole by scripts/refresh-goal-broadcasts.js; do not hand-edit — use assets/data/manual-channel-overrides.json, which outranks this file.",
    generatedAt: new Date().toISOString(),
    window: { from, days: LOOKAHEAD_DAYS },
    rows: sortedRows,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(sortedRows).length} override rows to ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`goal.com broadcast refresh failed: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = { collectFixtures, collectTvChannels, dayRange };
