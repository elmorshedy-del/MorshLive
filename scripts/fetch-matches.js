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
const { attachSummaries, buildHighlightQuery, pickArabicVideo } = require("./highlights-lib");
const { writeBindingsJs, writeLiveSnapshot } = require("./channel-bindings-lib");

const COMMENTATORS_URL = "https://almaghrebsport.com/commentators/";
const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";

const KEY = process.env.SPORTSDB_KEY || "3";
const centerDate = process.argv[2] || new Date().toISOString().slice(0, 10);
const OUT = path.join(__dirname, "..", "assets", "data", "today.json");
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

/** Search YouTube for an Arabic-commentary highlights video for one match. */
async function fetchYouTubeHighlight(match) {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: "5",
    order: "relevance",
    relevanceLanguage: "ar",
    videoEmbeddable: "true",
    safeSearch: "strict",
    q: buildHighlightQuery(match),
    key: process.env.YOUTUBE_API_KEY,
  });
  const kickoffMs = Date.parse(match.kickoffUtc || "");
  if (!isNaN(kickoffMs)) params.set("publishedAfter", new Date(kickoffMs).toISOString());
  const json = await get(`${YOUTUBE_SEARCH_URL}?${params.toString()}`);
  if (json.error) throw new Error(json.error.message || "YouTube API error");
  return pickArabicVideo(json.items);
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
  // network needed) plus an Arabic-commentary highlight video from YouTube
  // (https://developers.google.com/youtube/v3) when a free YOUTUBE_API_KEY is
  // configured. Once a match has a pinned clip we never re-query for it, so a
  // day of World Cup fixtures stays well inside YouTube's free search quota.
  attachSummaries(matches);
  const highlightsByKey = new Map(
    ((previousPayload && previousPayload.highlightsIndex) || []).map((h) => [h.key, h])
  );
  let highlightsMatched = 0;
  for (const m of matches) {
    if (m.status !== "ended") continue;
    const key = pairKey(m.home, m.away);
    const pinned = highlightsByKey.get(key);
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

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  writeBindingsJs();
  const snapshot = writeLiveSnapshot(matches);
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
        matches,
      },
      null,
      2
    )
  );
  console.log(
    `Wrote ${matches.length} matches (${commentaryMatched} with commentators, ${highlightsMatched} with highlight clips) -> ${path.relative(process.cwd(), OUT)}`
  );
  console.log(
    `Live snapshot: ${snapshot.liveCount} live, ${snapshot.conflicts.length} conflict(s) -> assets/data/live-snapshot.json`
  );
})().catch((err) => {
  console.error("fetch-matches failed:", err.message);
  process.exit(1);
});
