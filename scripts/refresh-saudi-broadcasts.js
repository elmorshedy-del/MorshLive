#!/usr/bin/env node
/* ============================================================================
 * refresh-saudi-broadcasts.js — Lightweight pre-match Saudi channel hydration.
 *
 * This intentionally does NOT run the expensive match/highlight/tournament
 * crawl. Fixture identity comes from ESPN ksa.1. Exact numbered Thmanyah
 * assignments come from the Saudi TV guide adapter, with the verified Thmanyah
 * rights-holder network as the lower-confidence fallback.
 *
 * The result is stored in a dedicated `broadcastIndex` inside today.json. A
 * compatibility projection is also merged into `commentaryIndex`, which the
 * current browser already hydrates onto live ESPN fixtures. European/beIN rows
 * are not changed by this refresher.
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const { normalizeEspnEvent } = require("./matches-lib");
const { attachCommentators, pairKey } = require("./commentators-lib");
const { applySaudiTvGuide, parseSaudiTvGuide } = require("./saudi-tv-guide-lib");

const ESPN_SLUG = "ksa.1";
const COMMENTATORS_URL = "https://almaghrebsport.com/commentators/";
const TV_GUIDE_URL = "https://www.livefootballtv.info/competition/liga-profesional-saudi";
const OUT = path.join(__dirname, "..", "assets", "data", "today.json");
const LOOKAHEAD_DAYS = 7;
const SERVER_UA = "curl/8.5.0";
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function arabiaTodayIso() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shiftDate(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function espnDateRange(center) {
  const start = shiftDate(center, -1).replace(/-/g, "");
  const end = shiftDate(center, LOOKAHEAD_DAYS).replace(/-/g, "");
  return `${start}-${end}`;
}

async function fetchWithTimeout(url, { text = false, userAgent = BROWSER_UA } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent,
        "Accept-Language": "ar,en;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
    return text ? response.text() : response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSaudiFixtures(centerDate) {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_SLUG}/scoreboard` +
    `?dates=${espnDateRange(centerDate)}&limit=100`;
  const json = await fetchWithTimeout(url, { userAgent: SERVER_UA });
  const league = { ...(json.leagues?.[0] || {}), slug: ESPN_SLUG };
  return (json.events || []).map((event) => normalizeEspnEvent(event, league));
}

function exactThmanyah(row) {
  return /^thmanyah-[123]$/.test(String(row?.broadcast?.channelId || ""));
}

function sameFixture(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  return a.key === b.key && a.kickoffUtc === b.kickoffUtc;
}

function preservePreviousExact(freshRows, previousRows) {
  const previous = Array.isArray(previousRows) ? previousRows : [];
  return freshRows.map((row) => {
    if (exactThmanyah(row)) return row;
    const pinned = previous.find((candidate) => sameFixture(candidate, row) && exactThmanyah(candidate));
    if (!pinned) return row;
    return {
      ...row,
      channel: pinned.channel,
      broadcast: {
        ...pinned.broadcast,
        source: `${pinned.broadcast.source || "previous"}:pinned`,
      },
      commentators: row.commentators?.length ? row.commentators : pinned.commentators || [],
    };
  });
}

function buildBroadcastIndex(matches, commentaryIndex, previousRows) {
  const commentaryByKey = new Map((commentaryIndex || []).map((row) => [row.key, row]));
  const rows = matches.map((match) => {
    const key = pairKey(match.home, match.away);
    const commentary = commentaryByKey.get(key);
    return {
      id: match.id,
      key,
      home: match.home,
      away: match.away,
      kickoffUtc: match.kickoffUtc || null,
      leagueSlug: ESPN_SLUG,
      channel: commentary?.channel || match.channel || "ثمانية",
      broadcast:
        commentary?.broadcast ||
        match.broadcast || {
          provider: "thmanyah",
          channelId: "thmanyah",
          source: "spl-rights-holder",
          confidence: "network",
        },
      commentators: commentary?.commentators || match.commentators || [],
    };
  });

  return preservePreviousExact(rows, previousRows).sort((a, b) => {
    const byKickoff = String(a.kickoffUtc || "").localeCompare(String(b.kickoffUtc || ""));
    return byKickoff || a.key.localeCompare(b.key);
  });
}

function mergeCommentaryIndex(previousRows, broadcastRows) {
  const currentKeys = new Set(broadcastRows.map((row) => row.key));
  const nonSaudiCurrent = (Array.isArray(previousRows) ? previousRows : []).filter((row) => {
    if (currentKeys.has(row?.key)) return false;
    return row?.broadcast?.provider !== "thmanyah";
  });
  const projection = broadcastRows.map((row) => ({
    key: row.key,
    home: row.home,
    away: row.away,
    commentators: row.commentators || [],
    channel: row.channel,
    broadcast: row.broadcast,
    locked: false,
  }));
  return [...nonSaudiCurrent, ...projection];
}

function semanticBroadcastRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row.id,
    key: row.key,
    home: row.home,
    away: row.away,
    kickoffUtc: row.kickoffUtc,
    leagueSlug: row.leagueSlug,
    channel: row.channel,
    broadcast: row.broadcast,
    commentators: row.commentators || [],
  }));
}

function rowsChanged(previous, next) {
  return JSON.stringify(semanticBroadcastRows(previous)) !== JSON.stringify(semanticBroadcastRows(next));
}

async function optionalText(url, label) {
  try {
    return await fetchWithTimeout(url, { text: true, userAgent: BROWSER_UA });
  } catch (error) {
    console.log(`${label} unavailable (${error.message}); continuing with remaining sources`);
    return "";
  }
}

async function main() {
  const centerDate = process.argv[2] || arabiaTodayIso();
  const previousPayload = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const [matches, guideHtml, commentatorsHtml] = await Promise.all([
    fetchSaudiFixtures(centerDate),
    optionalText(TV_GUIDE_URL, "Saudi TV guide"),
    optionalText(COMMENTATORS_URL, "Arabic commentator feed"),
  ]);

  const { commentaryIndex } = attachCommentators(matches, commentatorsHtml);
  const guideRows = parseSaudiTvGuide(guideHtml);
  const exactMatches = applySaudiTvGuide(matches, commentaryIndex, guideRows);
  console.log(`Saudi TV guide: ${guideRows.length} exact rows, ${exactMatches} matched ESPN fixtures`);

  const broadcastIndex = buildBroadcastIndex(
    matches,
    commentaryIndex,
    previousPayload.broadcastIndex || [],
  );

  if (!rowsChanged(previousPayload.broadcastIndex, broadcastIndex)) {
    console.log(`Saudi broadcasts unchanged (${broadcastIndex.length} fixtures)`);
    return;
  }

  const nextPayload = {
    ...previousPayload,
    broadcastSource: "espn-ksa.1 + livefootballtv + thmanyah-rights",
    broadcastUpdatedAt: new Date().toISOString(),
    broadcastIndex,
    commentaryIndex: mergeCommentaryIndex(previousPayload.commentaryIndex, broadcastIndex),
  };

  fs.writeFileSync(OUT, `${JSON.stringify(nextPayload, null, 2)}\n`);
  const exact = broadcastIndex.filter(exactThmanyah).length;
  console.log(`Saudi broadcasts updated: ${broadcastIndex.length} fixtures (${exact} exact numbered channels)`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Saudi broadcast refresh failed: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildBroadcastIndex,
  mergeCommentaryIndex,
  preservePreviousExact,
  rowsChanged,
};
