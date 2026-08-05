#!/usr/bin/env node
/* ============================================================================
 * fetch-tournament-archive.js — World Cup 2026 full tournament archive:
 * all ended matches by stage, ملخص highlights, viral X/Twitter memes.
 *
 * Usage:  node scripts/fetch-tournament-archive.js
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const https = require("https");
const { normalizeEspnEvent, parseKickoffMs } = require("./matches-lib");
const { arabicTeamToEnglish, pairKey } = require("./commentators-lib");
const { attachSummaries } = require("./highlights-lib");
const { findKnownVortexHighlights, normalizeHighlightBucket, pickPrimaryHighlight } = require("./vortex-highlights-lib");
const { arabicTeam } = require("./highlights-lib");
const { enrichEndedMatchesWithHighlights } = require("./highlight-enrich-lib");
const { discoverLatestHighlightMemes, discoverAllMatchMemes } = require("./twitter-memes-lib");
const { attachMatchMeta, orderMemesChronological } = require("./lib/meme-match-lib");

const OUT = path.join(__dirname, "..", "assets", "data", "tournament-archive.json");
const MEMES_OUT = path.join(__dirname, "..", "assets", "data", "match-memes.json");
const PINNED_MEMES = path.join(__dirname, "..", "assets", "data", "pinned-match-memes.json");
const KNOWN_VORTEX = path.join(__dirname, "..", "assets", "data", "vortex-highlights.json");
const TODAY = path.join(__dirname, "..", "assets", "data", "today.json");
const TEAM_AR = path.join(__dirname, "..", "assets", "data", "team-names-ar.json");

const ESPN_START = "2026-06-10";
const ESPN_END = "2026-07-19";
const ESPN_CHUNK_DAYS = 10;

const STAGES = [
  { id: "group-stage", labelAr: "دور المجموعات", labelEn: "Group Stage" },
  { id: "round-of-32", labelAr: "دور الـ32", labelEn: "Round of 32" },
  { id: "round-of-16", labelAr: "دور الـ16", labelEn: "Round of 16" },
  { id: "quarterfinals", labelAr: "ربع النهائي", labelEn: "Quarter-finals" },
  { id: "semifinals", labelAr: "نصف النهائي", labelEn: "Semi-finals" },
  { id: "final", labelAr: "النهائي", labelEn: "Final" },
];

// ESPN edge blocks many custom UAs (403) but accepts curl — keep builds working.
const ESPN_HEADERS = { "User-Agent": "curl/8.5.0" };

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: ESPN_HEADERS }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const trimmed = d.trimStart();
          if (trimmed.startsWith("<")) {
            reject(new Error("non-JSON response (upstream access denied?)"));
            return;
          }
          try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
        });
      })
      .on("error", reject);
  });
}

function shiftDateIso(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ESPN blocks very wide scoreboard date ranges — fetch in short windows. */
function espnDateChunks(startIso, endIso, chunkDays = ESPN_CHUNK_DAYS) {
  const chunks = [];
  let start = startIso;
  while (start <= endIso) {
    const tentativeEnd = shiftDateIso(start, chunkDays - 1);
    const chunkEnd = tentativeEnd > endIso ? endIso : tentativeEnd;
    chunks.push(`${start.replace(/-/g, "")}-${chunkEnd.replace(/-/g, "")}`);
    start = shiftDateIso(chunkEnd, 1);
  }
  return chunks;
}

function buildArToEn() {
  const map = JSON.parse(fs.readFileSync(TEAM_AR, "utf8"));
  const out = new Map();
  for (const [en, ar] of Object.entries(map)) {
    out.set(ar, en);
    out.set(ar.replace(/\s+/g, ""), en);
  }
  return (ar) =>
    arabicTeamToEnglish(ar) || out.get(ar) || out.get(ar.replace(/\s+/g, "")) || ar;
}

async function fetchAllEspnEnded() {
  const chunks = espnDateChunks(ESPN_START, ESPN_END);
  const defaultLeague = { slug: "fifa.world", name: "FIFA World Cup" };
  const matches = [];
  const seenIds = new Set();

  for (const dateRange of chunks) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateRange}&limit=200`;
    try {
      const json = await get(url);
      const league = json.leagues?.[0] || defaultLeague;
      for (const e of json.events || []) {
        if (seenIds.has(e.id)) continue;
        const state = e.competitions?.[0]?.status?.type?.state;
        if (state !== "post") continue;
        seenIds.add(e.id);
        const m = normalizeEspnEvent(e, league);
        m.stage = e.season?.slug || "group-stage";
        m.key = pairKey(m.home, m.away);
        m.eventId = String(e.id);
        matches.push(m);
      }
    } catch (err) {
      console.warn(`ESPN archive chunk ${dateRange} failed: ${err.message}`);
    }
  }

  if (!matches.length) throw new Error("ESPN returned no ended World Cup matches");
  matches.sort((a, b) => parseKickoffMs(a.kickoffUtc) - parseKickoffMs(b.kickoffUtc));
  return matches;
}

function buildPreviousByKey(matches, extras = []) {
  const map = new Map();
  for (const m of matches || []) {
    if (m.key) map.set(m.key, m);
  }
  for (const row of extras) {
    if (!row?.key) continue;
    const prev = map.get(row.key) || { key: row.key, home: row.home, away: row.away };
    if (row.videoUrl) {
      prev.highlight = {
        videoUrl: row.videoUrl,
        title: row.title,
        source: row.source,
        embedId: row.embedId,
        thumbnail: row.thumbnail || "",
      };
    }
    map.set(row.key, prev);
  }
  return map;
}

async function applyKnownVortexToMap(matches, map) {
  for (const m of matches) {
    const known = await findKnownVortexHighlights(m);
    const bucket = await normalizeHighlightBucket({
      goals: known.goals || null,
      full: known.full || null,
    });
    if (!bucket) continue;
    const prev = map.get(m.key) || { ...m };
    prev.highlights = { ...(prev.highlights || {}) };
    if (bucket.goals) prev.highlights.goals = bucket.goals;
    if (bucket.full) prev.highlights.full = bucket.full;
    prev.highlight = pickPrimaryHighlight(prev.highlights) || prev.highlights.full || prev.highlights.goals;
    map.set(m.key, prev);
  }
}

function persistVortexKnown(matches, knownVortex) {
  const out = { ...knownVortex };
  for (const m of matches) {
    if (!m.key || !m.highlights) continue;
    const goals = m.highlights.goals?.embedId;
    const full = m.highlights.full?.embedId;
    if (!goals && !full) continue;
    out[m.key] = goals && full ? { goals, full } : (full || goals);
  }
  return out;
}

async function main() {
  console.log("Fetching ESPN World Cup archive…");
  let matches;
  try {
    matches = await fetchAllEspnEnded();
  } catch (err) {
    console.warn(`ESPN archive fetch failed: ${err.message}`);
    if (fs.existsSync(OUT)) {
      console.warn(`Keeping existing archive → ${OUT}`);
      return;
    }
    throw err;
  }
  attachSummaries(matches);

  const arToEn = buildArToEn();
  let previousMatches = [];
  try {
    if (fs.existsSync(OUT)) {
      const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
      previousMatches = prev.matches || [];
    }
  } catch { /* */ }

  let knownVortex = {};
  try { knownVortex = JSON.parse(fs.readFileSync(KNOWN_VORTEX, "utf8")); } catch { /* */ }

  const todayHighlights = [];
  let todayDetails = new Map();
  try {
    const today = JSON.parse(fs.readFileSync(TODAY, "utf8"));
    todayHighlights.push(...(today.highlightsIndex || []));
    for (const m of today.matches || []) {
      todayDetails.set(m.key, { lineups: m.lineups || null, stats: m.stats || null });
    }
    for (const d of today.matchDetailIndex || []) {
      todayDetails.set(d.key, {
        lineups: d.lineups || todayDetails.get(d.key)?.lineups || null,
        stats: d.stats || todayDetails.get(d.key)?.stats || null,
      });
    }
  } catch { /* */ }

  const previousByKey = buildPreviousByKey(previousMatches, todayHighlights);
  await applyKnownVortexToMap(matches, previousByKey);

  for (const m of matches) {
    const details = todayDetails.get(m.key);
    if (details?.lineups && !m.lineups) m.lineups = details.lineups;
    if (details?.stats && !m.stats) m.stats = details.stats;
  }

  const { matched, total } = await enrichEndedMatchesWithHighlights(matches, {
    pairKeyFn: (home, away) => pairKey(home, away),
    btolatPairKeyFn: (a, b) => {
      const home = arToEn(a) || a;
      const away = arToEn(b) || b;
      return pairKey(home, away);
    },
    arabicTeam,
    previousByKey,
    concurrency: 4,
  });
  console.log(`ملخص video attached: ${matched}/${total} ended matches`);

  const updatedKnown = persistVortexKnown(matches, knownVortex);
  fs.writeFileSync(KNOWN_VORTEX, JSON.stringify(updatedKnown, null, 2));

  let pinnedMemes = {};
  try { pinnedMemes = JSON.parse(fs.readFileSync(PINNED_MEMES, "utf8")); } catch { /* */ }
  let existingMemes = {};
  try { existingMemes = JSON.parse(fs.readFileSync(MEMES_OUT, "utf8")); } catch { /* */ }

  const memes = { ...existingMemes };
  for (const [key, list] of Object.entries(pinnedMemes)) {
    if (list.length) memes[key] = list;
  }

  const token = process.env.TWITTER_BEARER_TOKEN;
  if (token && process.env.TWITTER_FETCH_ALL === "1") {
    console.warn("TWITTER_FETCH_ALL=1 — bulk meme scan (many API calls; not recommended)");
    const discovered = await discoverAllMatchMemes(matches);
    for (const [key, list] of Object.entries(discovered)) {
      if (list.length) memes[key] = list;
    }
  } else {
    console.log("Fetching recent X media for latest highlight matches (syndication; bearer token used when set)");
    const discovered = await discoverLatestHighlightMemes(matches, { pinnedMemes, maxMatches: 6 });
    for (const [key, list] of Object.entries(discovered)) {
      if (list.length) memes[key] = list;
    }
  }

  const memeCount = Object.keys(memes).filter((k) => memes[k].length).length;
  console.log(`memes for ${memeCount} matches (${Object.keys(pinnedMemes).length} pinned)`);

  const matchByKey = new Map(matches.map((m) => [m.key, m]));
  const memesWithScores = {};
  for (const [key, list] of Object.entries(memes)) {
    const m = matchByKey.get(key);
    memesWithScores[key] = orderMemesChronological(
      (list || []).map((item) => attachMatchMeta(item, m))
    );
  }

  const stageCounts = {};
  for (const m of matches) stageCounts[m.stage] = (stageCounts[m.stage] || 0) + 1;

  const payload = {
    updatedAt: new Date().toISOString(),
    tournament: "FIFA World Cup 2026",
    stages: STAGES.filter((s) => stageCounts[s.id]).map((s) => ({
      ...s,
      matchCount: stageCounts[s.id] || 0,
    })),
    matchCount: matches.length,
    memeMatchCount: memeCount,
    matches,
    memes: memesWithScores,
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  fs.writeFileSync(MEMES_OUT, JSON.stringify(memesWithScores, null, 2));
  console.log(`Wrote ${matches.length} ended matches → ${OUT}`);
  console.log(`Wrote memes for ${memeCount} matches → ${MEMES_OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
