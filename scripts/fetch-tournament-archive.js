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
const { scrapeBtolatHighlights, applyBtolatHighlights } = require("./btolat-highlights-lib");
const { findKnownVortexHighlight, findKnownVortexHighlights, fetchVortexEmbedMeta, normalizeHighlightBucket, enrichHighlightMeta, pickPrimaryHighlight } = require("./vortex-highlights-lib");
const { arabicTeam } = require("./highlights-lib");
const { discoverLatestHighlightMemes, discoverAllMatchMemes } = require("./twitter-memes-lib");

const OUT = path.join(__dirname, "..", "assets", "data", "tournament-archive.json");
const MEMES_OUT = path.join(__dirname, "..", "assets", "data", "match-memes.json");
const PINNED_MEMES = path.join(__dirname, "..", "assets", "data", "pinned-match-memes.json");
const KNOWN_VORTEX = path.join(__dirname, "..", "assets", "data", "vortex-highlights.json");
const TODAY = path.join(__dirname, "..", "assets", "data", "today.json");
const TEAM_AR = path.join(__dirname, "..", "assets", "data", "team-names-ar.json");

const ESPN_RANGE = "20260610-20260719";

const STAGES = [
  { id: "group-stage", labelAr: "دور المجموعات", labelEn: "Group Stage" },
  { id: "round-of-32", labelAr: "دور الـ32", labelEn: "Round of 32" },
  { id: "round-of-16", labelAr: "دور الـ16", labelEn: "Round of 16" },
  { id: "quarterfinals", labelAr: "ربع النهائي", labelEn: "Quarter-finals" },
  { id: "semifinals", labelAr: "نصف النهائي", labelEn: "Semi-finals" },
  { id: "final", labelAr: "النهائي", labelEn: "Final" },
];

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
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${ESPN_RANGE}&limit=200`;
  const json = await get(url);
  const league = json.leagues?.[0] || { slug: "fifa.world", name: "FIFA World Cup" };
  const matches = [];
  for (const e of json.events || []) {
    const state = e.competitions?.[0]?.status?.type?.state;
    if (state !== "post") continue;
    const m = normalizeEspnEvent(e, league);
    m.stage = e.season?.slug || "group-stage";
    m.key = pairKey(m.home, m.away);
    m.eventId = String(e.id);
    matches.push(m);
  }
  matches.sort((a, b) => parseKickoffMs(a.kickoffUtc) - parseKickoffMs(b.kickoffUtc));
  return matches;
}

async function main() {
  console.log("Fetching ESPN World Cup archive…");
  const matches = await fetchAllEspnEnded();
  attachSummaries(matches);

  const arToEn = buildArToEn();
  const btolatMap = await scrapeBtolatHighlights(
    (a, b) => {
      const home = arToEn(a) || a;
      const away = arToEn(b) || b;
      return pairKey(home, away);
    },
    (id) => fetchVortexEmbedMeta(id, { allowAnyTitle: true }),
    { matches, arabicTeam }
  );
  const dualCount = [...btolatMap.values()].filter((b) => b.goals && b.full).length;
  console.log(`btolat highlights: ${btolatMap.size} matches (${dualCount} with goals+full)`);

  let knownVortex = {};
  try { knownVortex = JSON.parse(fs.readFileSync(KNOWN_VORTEX, "utf8")); } catch { /* */ }
  let todayHighlights = new Map();
  let todayDetails = new Map();
  try {
    const today = JSON.parse(fs.readFileSync(TODAY, "utf8"));
    for (const h of today.highlightsIndex || []) todayHighlights.set(h.key, h);
    for (const m of today.matches || []) todayDetails.set(m.key, {
      lineups: m.lineups || null,
      stats: m.stats || null,
    });
    for (const d of today.matchDetailIndex || []) todayDetails.set(d.key, {
      lineups: d.lineups || todayDetails.get(d.key)?.lineups || null,
      stats: d.stats || todayDetails.get(d.key)?.stats || null,
    });
  } catch { /* */ }

  for (const m of matches) {
    const details = todayDetails.get(m.key);
    if (details?.lineups && !m.lineups) m.lineups = details.lineups;
    if (details?.stats && !m.stats) m.stats = details.stats;

    const bt = btolatMap.get(m.key);
    const pinned = todayHighlights.get(m.key);
    if (bt && applyBtolatHighlights(m, bt, normalizeHighlightBucket)) {
      continue;
    }
    if (pinned?.videoUrl) {
      const meta = await enrichHighlightMeta({
        videoUrl: pinned.videoUrl,
        title: pinned.title,
        source: pinned.source,
        embedId: pinned.embedId,
        thumbnail: pinned.thumbnail || "",
      });
      if (meta) m.highlight = meta;
    } else if (knownVortex[m.key]) {
      const known = await findKnownVortexHighlights(m);
      const bucket = await normalizeHighlightBucket({
        goals: known.goals || null,
        full: known.full || null,
      });
      if (bucket && (bucket.goals || bucket.full)) {
        m.highlights = {};
        if (bucket.goals) m.highlights.goals = bucket.goals;
        if (bucket.full) m.highlights.full = bucket.full;
        m.highlight = pickPrimaryHighlight(m.highlights) || m.highlights.full || m.highlights.goals;
      }
    }
  }

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
    memes,
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  fs.writeFileSync(MEMES_OUT, JSON.stringify(memes, null, 2));
  console.log(`Wrote ${matches.length} ended matches → ${OUT}`);
  console.log(`Wrote memes for ${memeCount} matches → ${MEMES_OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
