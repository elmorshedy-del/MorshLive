#!/usr/bin/env node
/* ============================================================================
 * fetch-matches.js — Pulls fixtures from TheSportsDB plus ESPN fallback.
 * Writes assets/data/today.json as offline cache / GitHub Pages fallback.
 *
 * Usage:  node scripts/fetch-matches.js [YYYY-MM-DD]
 * Env:    SPORTSDB_KEY (optional, default "3")
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const https = require("https");
const {
  filterDisplayMatches,
  mergeMatches,
  normalizeEspnEvent,
  normalizeEvent,
  sortMatches,
  WORLD_CUP_RE,
} = require("./matches-lib");
const {
  attachCommentators,
  mergeCommentaryIndex,
  pairKey,
  pinEndedChannels,
} = require("./commentators-lib");
const { attachSummaries, buildHighlightQueries, pickArabicVideo, arabicTeam } = require("./highlights-lib");
const { findVortexHighlight, fetchVortexEmbedMeta, normalizeHighlightBucket, enrichHighlightMeta, pickPrimaryHighlight } = require("./vortex-highlights-lib");
const { scrapeBtolatHighlights, applyBtolatHighlights } = require("./btolat-highlights-lib");
const { parseEspnMatchId, extractLineups, extractMatchStats } = require("./match-detail-lib");
const { writeBindingsJs, writeLiveSnapshot } = require("./channel-bindings-lib");
const { writePollConfig } = require("./match-poll-lib");

const COMMENTATORS_URL = "https://almaghrebsport.com/commentators/";
const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";

const KEY = process.env.SPORTSDB_KEY || "3";
const centerDate = process.argv[2] || new Date().toISOString().slice(0, 10);
const OUT = path.join(__dirname, "..", "assets", "data", "today.json");
const BANNERS_OUT = path.join(__dirname, "..", "assets", "data", "highlights-banners.json");
const TEAM_AR = path.join(__dirname, "..", "assets", "data", "team-names-ar.json");
// World Cup only for now.
const ESPN_LEAGUES = ["fifa.world"];

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

function getText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
          "Accept-Language": "ar,en;q=0.8",
        },
      }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
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
  const events = Array.isArray(json.events) ? json.events : [];
  return events.filter((e) => WORLD_CUP_RE.test(e.strLeague || ""));
}

function espnDateRange(center) {
  return `${shiftDate(center, -1).replace(/-/g, "")}-${shiftDate(center, 1).replace(/-/g, "")}`;
}

async function fetchEspnLeague(slug, dateRange) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${dateRange}&limit=100`;
  const json = await get(url);
  const league = json.leagues && json.leagues[0] ? json.leagues[0] : { slug };
  const events = Array.isArray(json.events) ? json.events : [];
  return events.map((event) => normalizeEspnEvent(event, league));
}

async function fetchEspnSummary(leagueSlug, eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/summary?event=${eventId}`;
  return get(url);
}

function buildArToEn() {
  const map = JSON.parse(fs.readFileSync(TEAM_AR, "utf8"));
  const out = new Map();
  for (const [en, ar] of Object.entries(map)) {
    out.set(ar, en);
    out.set(ar.replace(/\s+/g, ""), en);
  }
  out.set("باراجواي", "Paraguay");
  out.set("الولايات المتحدة", "United States");
  out.set("كوريا الجنوبية", "South Korea");
  out.set("ساحل العاج", "Ivory Coast");
  return (ar) => out.get(ar) || out.get(String(ar).replace(/\s+/g, "")) || ar;
}

/** Search YouTube for an Arabic-commentary highlights video for one match. */
async function fetchYouTubeHighlight(match) {
  const queries = buildHighlightQueries(match, arabicTeam);
  for (const q of queries) {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      maxResults: "5",
      order: "relevance",
      relevanceLanguage: "ar",
      videoEmbeddable: "true",
      safeSearch: "strict",
      q,
      key: process.env.YOUTUBE_API_KEY,
    });
    const kickoffMs = Date.parse(match.kickoffUtc || "");
    if (!isNaN(kickoffMs)) params.set("publishedAfter", new Date(kickoffMs).toISOString());
    const json = await get(`${YOUTUBE_SEARCH_URL}?${params.toString()}`);
    if (json.error) throw new Error(json.error.message || "YouTube API error");
    const found = pickArabicVideo(json.items);
    if (found) return found;
  }
  return null;
}

(async () => {
  const dates = [shiftDate(centerDate, -1), centerDate, shiftDate(centerDate, 1)];
  const seen = new Set();
  const sportsDbMatches = [];

  for (const date of dates) {
    const events = await fetchDay(date);
    for (const e of events) {
      const id = "e" + e.idEvent;
      if (seen.has(id)) continue;
      seen.add(id);
      sportsDbMatches.push(normalizeEvent(e));
    }
  }

  const espnResults = await Promise.allSettled(
    ESPN_LEAGUES.map((slug) => fetchEspnLeague(slug, espnDateRange(centerDate)))
  );
  const espnMatches = espnResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const matches = filterDisplayMatches(mergeMatches(sportsDbMatches, espnMatches));
  sortMatches(matches);
  const sourceLabel = sportsDbMatches.length && espnMatches.length
    ? "TheSportsDB + ESPN"
    : sportsDbMatches.length
      ? "TheSportsDB"
      : "ESPN";

  // Best-effort: attach Arabic commentators (المعلّق) from full-coverage source.
  let commentaryIndex = [];
  let commentaryMatched = 0;
  try {
    const html = await getText(COMMENTATORS_URL);
    const result = attachCommentators(matches, html);
    commentaryIndex = result.commentaryIndex;
    commentaryMatched = result.matched;
  } catch (err) {
    console.warn("commentators fetch failed:", err.message);
  }

  // Pin broadcast channels for ended fixtures, then merge commentary without
  // letting a fresh commentators fetch overwrite them (e.g. MAX 2 on Turkey/USA).
  let previousPayload = null;
  try {
    previousPayload = JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch (_) {
    /* first run */
  }
  pinEndedChannels(matches, previousPayload);
  commentaryIndex = mergeCommentaryIndex(
    commentaryIndex,
    (previousPayload && previousPayload.commentaryIndex) || [],
    matches
  );
  const commentaryByKey = new Map(commentaryIndex.map((c) => [c.key, c]));
  for (const m of matches) {
    const row = commentaryByKey.get(pairKey(m.home, m.away));
    if (!row) continue;
    if (row.commentators && row.commentators.length) {
      m.commentators = row.commentators;
      m.commentator = row.commentators[0].name;
    }
    if (row.channel) m.channel = row.channel;
    if (row.channelId) m.channelId = row.channelId;
  }

  // ملخص المباريات: Arabic text summary for every ended match (always, no
  // network needed) plus an Arabic-commentary highlight clip — vortexvisionworks
  // embeds first (btolat/kawkabnews source), then YouTube when YOUTUBE_API_KEY
  // is set. Vortex pins are kept; YouTube pins are upgraded when vortex is found.
  attachSummaries(matches);
  const highlightsByKey = new Map(
    ((previousPayload && previousPayload.highlightsIndex) || []).map((h) => [h.key, h])
  );
  let highlightsMatched = 0;
  const arToEn = buildArToEn();
  let btolatMap = new Map();
  try {
    btolatMap = await scrapeBtolatHighlights(
      (a, b) => pairKey(arToEn(a), arToEn(b)),
      (id) => fetchVortexEmbedMeta(id)
    );
    const dualCount = [...btolatMap.values()].filter((b) => b.goals && b.full).length;
    console.log(`btolat highlights: ${btolatMap.size} matches (${dualCount} with goals+full)`);
  } catch (err) {
    console.warn("btolat highlights scrape failed:", err.message);
  }
  for (const m of matches) {
    if (m.status !== "ended") continue;
    const key = pairKey(m.home, m.away);
    const pinned = highlightsByKey.get(key);
    if (pinned && pinned.source === "vortex") {
      const meta = await enrichHighlightMeta({
        videoUrl: pinned.videoUrl,
        title: pinned.title,
        channelTitle: pinned.channelTitle,
        thumbnail: pinned.thumbnail,
        source: pinned.source,
        embedId: pinned.embedId,
      });
      if (meta) {
        m.highlight = meta;
        highlightsMatched++;
      }
      continue;
    }
    const bt = btolatMap.get(key);
    if (bt && applyBtolatHighlights(m, bt, normalizeHighlightBucket)) {
      const primary = m.highlight;
      highlightsByKey.set(key, { key, home: m.home, away: m.away, ...primary });
      if (m.highlights?.goals) {
        highlightsByKey.set(`${key}~goals`, { key, home: m.home, away: m.away, ...m.highlights.goals, clip: "goals" });
      }
      if (m.highlights?.full) {
        highlightsByKey.set(`${key}~full`, { key, home: m.home, away: m.away, ...m.highlights.full, clip: "full" });
      }
      highlightsMatched++;
      continue;
    }
    try {
      const vortex = await findVortexHighlight(m, arabicTeam);
      const meta = await enrichHighlightMeta(vortex);
      if (meta) {
        m.highlight = meta;
        highlightsByKey.set(key, { key, home: m.home, away: m.away, ...meta });
        highlightsMatched++;
        continue;
      }
    } catch (err) {
      console.warn(`vortex highlight search failed for ${m.home} vs ${m.away}:`, err.message);
    }
    if (pinned) {
      m.highlight = {
        videoUrl: pinned.videoUrl,
        title: pinned.title,
        channelTitle: pinned.channelTitle,
        thumbnail: pinned.thumbnail,
        source: pinned.source,
      };
      highlightsMatched++;
      continue;
    }
    if (!process.env.YOUTUBE_API_KEY) continue;
    try {
      const found = await fetchYouTubeHighlight(m);
      if (found) {
        m.highlight = found;
        highlightsByKey.set(key, { key, home: m.home, away: m.away, ...found });
        highlightsMatched++;
      }
    } catch (err) {
      console.warn(`youtube highlight search failed for ${m.home} vs ${m.away}:`, err.message);
    }
  }
  const highlightsIndex = Array.from(highlightsByKey.values());

  function buildHighlightsBanners(endedMatches) {
    const daysMap = new Map();
    for (const m of endedMatches) {
      if (m.status !== "ended") continue;
      const primary = pickPrimaryHighlight(m.highlights) || m.highlight;
      if (!primary || !primary.videoUrl) continue;
      const day = String(m.kickoffUtc || "").slice(0, 10);
      if (!day) continue;
      if (!daysMap.has(day)) daysMap.set(day, []);
      daysMap.get(day).push({
        key: pairKey(m.home, m.away),
        home: m.home,
        away: m.away,
        score: m.score || "",
        kickoffUtc: m.kickoffUtc,
        poster: primary.thumbnail || "",
        stage: m.stage || "",
      });
    }
    const days = [...daysMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 21)
      .map(([date, dayMatches]) => ({
        date,
        matches: dayMatches.sort((a, b) => Date.parse(b.kickoffUtc) - Date.parse(a.kickoffUtc)),
      }));
    return { updatedAt: new Date().toISOString(), days };
  }

  const highlightsBanners = buildHighlightsBanners(matches);

  // Pre-match lineups + advanced live stats — same ESPN source already used
  // for scores, so coverage is limited to matches ESPN itself carries (an
  // "espn-..." id). TheSportsDB-only fixtures get no lineups/stats rather
  // than a guess from somewhere less trustworthy.
  const detailResults = await Promise.allSettled(
    matches.map(async (m) => {
      const parsed = parseEspnMatchId(m.id);
      if (!parsed) return null;
      try {
        const summary = await fetchEspnSummary(parsed.leagueSlug, parsed.eventId);
        return { m, summary };
      } catch (err) {
        console.warn(`match detail fetch failed for ${m.home} vs ${m.away}:`, err.message);
        return null;
      }
    })
  );
  const matchDetailIndex = [];
  let lineupsMatched = 0;
  let statsMatched = 0;
  for (const result of detailResults) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { m, summary } = result.value;
    const lineups = extractLineups(summary);
    const stats = extractMatchStats(summary);
    if (lineups) { m.lineups = lineups; lineupsMatched++; }
    if (stats) { m.stats = stats; statsMatched++; }
    if (lineups || stats) {
      matchDetailIndex.push({ key: pairKey(m.home, m.away), lineups: lineups || null, stats: stats || null });
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  writeBindingsJs();
  const snapshot = writeLiveSnapshot(matches);
  const pollDoc = writePollConfig(matches);
  fs.writeFileSync(BANNERS_OUT, JSON.stringify(highlightsBanners, null, 2));
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        date: centerDate,
        updatedAt: new Date().toISOString(),
        source: sportsDbMatches.length ? "thesportsdb" : "espn",
        sourceLabel,
        commentarySource: "almaghrebsport",
        commentaryIndex,
        highlightsIndex,
        matchDetailIndex,
        matches,
      },
      null,
      2
    )
  );
  console.log(
    `Wrote ${matches.length} matches (${commentaryMatched} with commentators, ${highlightsMatched} with highlight clips, ` +
    `${lineupsMatched} with lineups, ${statsMatched} with stats) -> ${path.relative(process.cwd(), OUT)}`
  );
  console.log(
    `Live snapshot: ${snapshot.liveCount} live, ${snapshot.conflicts.length} conflict(s) -> assets/data/live-snapshot.json`
  );
  console.log(
    `Match polls: ${pollDoc.polls.length} active -> assets/data/match-poll.json`
  );
})().catch((err) => {
  console.error("fetch-matches failed:", err.message);
  process.exit(1);
});
