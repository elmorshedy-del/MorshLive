#!/usr/bin/env node
/* ============================================================================
 * refresh-broadcasts.js — Lightweight pre-match channel hydration for every
 * supported league (EPL, LaLiga, UCL) other than Saudi.
 *
 * This intentionally does NOT run the expensive match/highlight/tournament
 * crawl. Fixture identity comes from ESPN across every league in
 * matches-lib.js's COMPETITIONS. Channel/commentator data comes from the same
 * almaghrebsport.com feed refresh-saudi-broadcasts.js already uses, resolved
 * through the shared broadcast-registry into the same canonical ids
 * (bein-sports-N, bein-max-N) assets/js/iptv-channel-resolver.js already
 * knows how to bind against the live IPTV catalog.
 *
 * Saudi Pro League keeps its own, more precise refresh
 * (refresh-saudi-broadcasts.js: TV-guide exact numbering + a dedicated
 * broadcastIndex). This script explicitly leaves SPL rows out of the
 * commentaryIndex rows it writes, so the two refreshers never race each
 * other or disagree about the same fixture — see
 * saudi-broadcast-refresh.test.js's "without touching European rows" case,
 * which this script relies on for its own merge to be safe.
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const { ESPN_LEAGUES, normalizeEspnEvent } = require("./matches-lib");
const { attachCommentators, mergeCommentaryIndex } = require("./commentators-lib");
const { isSaudiProLeagueMatch } = require("./broadcast-registry");

const COMMENTATORS_URL = "https://almaghrebsport.com/commentators/";
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

async function fetchLeagueFixtures(slug, centerDate) {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard` +
    `?dates=${espnDateRange(centerDate)}&limit=100`;
  try {
    const json = await fetchWithTimeout(url, { userAgent: SERVER_UA });
    const league = { ...(json.leagues?.[0] || {}), slug };
    return (json.events || []).map((event) => normalizeEspnEvent(event, league));
  } catch (error) {
    console.log(`${slug} fixtures unavailable (${error.message}); continuing with remaining leagues`);
    return [];
  }
}

async function fetchAllFixtures(centerDate) {
  const perLeague = await Promise.all(
    ESPN_LEAGUES.map((slug) => fetchLeagueFixtures(slug, centerDate)),
  );
  return perLeague.flat();
}

async function optionalText(url, label) {
  try {
    return await fetchWithTimeout(url, { text: true, userAgent: BROWSER_UA });
  } catch (error) {
    console.log(`${label} unavailable (${error.message}); continuing without it`);
    return "";
  }
}

/* Keep the two refreshers' domains disjoint: this script only ever writes
   rows for fixtures refresh-saudi-broadcasts.js does not own. */
function nonSaudiFixtures(matches) {
  return matches.filter((match) => !isSaudiProLeagueMatch(match));
}

async function main() {
  const centerDate = process.argv[2] || arabiaTodayIso();
  const previousPayload = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const [allMatches, commentatorsHtml] = await Promise.all([
    fetchAllFixtures(centerDate),
    optionalText(COMMENTATORS_URL, "Arabic commentator feed"),
  ]);

  const matches = nonSaudiFixtures(allMatches);
  const { matched, commentaryIndex: fresh } = attachCommentators(matches, commentatorsHtml);
  console.log(`Broadcast refresh: ${matches.length} non-Saudi fixtures, ${matched} matched a channel`);

  const commentaryIndex = mergeCommentaryIndex(fresh, previousPayload.commentaryIndex || [], matches);

  if (JSON.stringify(previousPayload.commentaryIndex || []) === JSON.stringify(commentaryIndex)) {
    console.log("Broadcasts unchanged");
    return;
  }

  const nextPayload = {
    ...previousPayload,
    commentarySource: "almaghrebsport",
    commentaryUpdatedAt: new Date().toISOString(),
    commentaryIndex,
  };

  fs.writeFileSync(OUT, `${JSON.stringify(nextPayload, null, 2)}\n`);
  console.log(`Broadcasts updated: ${commentaryIndex.length} commentary rows`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Broadcast refresh failed: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  fetchLeagueFixtures,
  nonSaudiFixtures,
};
