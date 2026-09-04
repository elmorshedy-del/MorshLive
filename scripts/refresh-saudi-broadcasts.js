#!/usr/bin/env node
/* ============================================================================
 * refresh-saudi-broadcasts.js — Lightweight pre-match Saudi channel hydration.
 *
 * This intentionally does NOT run the expensive match/highlight/tournament
 * crawl. It fetches only ESPN's Saudi Pro League schedule plus the existing
 * Arabic channel/commentator source, then updates a dedicated `broadcastIndex`
 * inside today.json. A compatibility projection is merged into
 * `commentaryIndex`, which the current browser already hydrates onto live ESPN
 * fixtures.
 *
 * Exact source channel (ثمانية 1/2/3) wins. When an exact number has not yet
 * been announced, the verified domestic rights-holder fallback is `ثمانية`.
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const { normalizeEspnEvent } = require("./matches-lib");
const { attachCommentators, pairKey } = require("./commentators-lib");

const ESPN_SLUG = "ksa.1";
const COMMENTATORS_URL = "https://almaghrebsport.com/commentators/";
const OUT = path.join(__dirname, "..", "assets", "data", "today.json");
const LOOKAHEAD_DAYS = 7;

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

async function fetchWithTimeout(url, { text = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept-Language": "ar,en;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return text ? response.text() : response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSaudiFixtures(centerDate) {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_SLUG}/scoreboard` +
    `?dates=${espnDateRange(centerDate)}&limit=100`;
  const json = await fetchWithTimeout(url);
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

async function main() {
  const centerDate = process.argv[2] || arabiaTodayIso();
  const previousPayload = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const matches = await fetchSaudiFixtures(centerDate);
  if (!matches.length) throw new Error("ESPN returned no Saudi Pro League fixtures in the refresh window");

  let html = "";
  try {
    html = await fetchWithTimeout(COMMENTATORS_URL, { text: true });
  } catch (error) {
    console.warn(`Saudi channel metadata fetch failed; using rights-holder fallback: ${error.message}`);
  }

  const { commentaryIndex } = attachCommentators(matches, html);
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
    broadcastSource: "espn-ksa.1 + almaghrebsport + thmanyah-rights",
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
