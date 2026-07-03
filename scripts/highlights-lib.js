/* ============================================================================
 * highlights-lib.js — ملخص المباراة (Arabic match summary) + highlight clip.
 *
 * Text summary: a templated Arabic recap built entirely from data already in
 * the fixture (final score, teams, venue, league, commentator) — always
 * available for an ended match, no external source or network call needed.
 *
 * Highlight video: matched against the Scorebat Video API
 * (https://www.scorebat.com/video-api/), which only distributes embed clips
 * the leagues/clubs have already licensed for redistribution. Requires a free
 * SCOREBAT_TOKEN (scorebat.com/video-api/) — skipped entirely when unset, so
 * the site still ships Arabic text summaries with zero extra config.
 *
 * We never inject Scorebat's embed HTML as-is: we pull the iframe `src` out
 * and validate it points at scorebat.com before rebuilding our own sandboxed
 * <iframe>, so a compromised/unexpected API response can't inject markup.
 * ==========================================================================*/
const { pairKey } = require("./commentators-lib");
const { TeamNames } = require("../assets/js/team-names.js");

function arabicTeam(name) {
  return TeamNames.arabicFor(name) || name;
}

function parseScoreParts(score) {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec((score || "").trim());
  if (!m) return null;
  return { home: parseInt(m[1], 10), away: parseInt(m[2], 10) };
}

/** Templated Arabic recap — score line + result + commentator, when known. */
function buildArabicSummary(match) {
  const homeAr = arabicTeam(match.home);
  const awayAr = arabicTeam(match.away);
  const league = match.league || "المباراة";
  const venue = match.venue ? ` على ملعب ${match.venue}` : "";
  const parts = parseScoreParts(match.score);

  let text;
  if (!parts) {
    text = `انتهت مباراة ${homeAr} و${awayAr} ضمن ${league}${venue}.`;
  } else if (parts.home === parts.away) {
    text = `انتهت المباراة بالتعادل بين ${homeAr} و${awayAr} بنتيجة ${parts.home}-${parts.away} ضمن ${league}${venue}.`;
  } else {
    const homeWon = parts.home > parts.away;
    const winnerAr = homeWon ? homeAr : awayAr;
    const loserAr = homeWon ? awayAr : homeAr;
    const winnerScore = Math.max(parts.home, parts.away);
    const loserScore = Math.min(parts.home, parts.away);
    text = `انتهت المباراة بفوز ${winnerAr} على ${loserAr} بنتيجة ${winnerScore}-${loserScore} ضمن ${league}${venue}.`;
  }
  if (match.commentator) text += ` تعليق: ${match.commentator}.`;
  return text;
}

const SCOREBAT_EMBED_RE = /^https:\/\/www\.scorebat\.com\/embed\//;

/** Pull the iframe src out of Scorebat's embed HTML; null unless it's really scorebat.com. */
function extractEmbedSrc(embedHtml) {
  const m = /src="([^"]+)"/.exec(embedHtml || "");
  if (!m) return null;
  return SCOREBAT_EMBED_RE.test(m[1]) ? m[1] : null;
}

/** Scorebat v3 feed items expose team names as side1/side2 (older shape: team1/team2). */
function teamNamesFromFeedItem(item) {
  if (item.side1 && item.side2) return [item.side1.name, item.side2.name];
  if (item.team1 && item.team2) return [item.team1, item.team2];
  const m = /^(.+?)\s+\d+\s*-\s*\d+\s+(.+)$/.exec(item.title || "");
  return m ? [m[1].trim(), m[2].trim()] : [null, null];
}

function findHighlightForMatch(match, feedItems) {
  const key = pairKey(match.home, match.away);
  for (const item of feedItems || []) {
    const [t1, t2] = teamNamesFromFeedItem(item);
    if (!t1 || !t2 || pairKey(t1, t2) !== key) continue;
    const video = (item.videos && item.videos[0]) || null;
    const videoUrl = video ? extractEmbedSrc(video.embed) : null;
    if (!videoUrl) continue;
    return {
      videoUrl,
      title: (video && video.title) || item.title || "",
      competition: item.competition || "",
      thumbnail: item.thumbnail || "",
      source: "scorebat",
    };
  }
  return null;
}

/** Generates m.summaryAr for every ended match and m.highlight where a clip matches. */
function attachHighlights(matches, feedItems) {
  let matched = 0;
  const highlightsIndex = [];
  for (const m of matches) {
    if (m.status !== "ended") continue;
    m.summaryAr = buildArabicSummary(m);
    const highlight = findHighlightForMatch(m, feedItems);
    if (!highlight) continue;
    matched++;
    m.highlight = highlight;
    highlightsIndex.push({ key: pairKey(m.home, m.away), home: m.home, away: m.away, ...highlight });
  }
  return { matched, highlightsIndex };
}

/** Keep previously-found clips around even if a later Scorebat fetch misses/fails. */
function mergeHighlightsIndex(fresh, previous) {
  const out = (fresh || []).slice();
  const seen = new Set(out.map((r) => r.key));
  for (const row of previous || []) {
    if (!row || !row.key || seen.has(row.key)) continue;
    out.push(row);
    seen.add(row.key);
  }
  return out;
}

module.exports = {
  buildArabicSummary,
  extractEmbedSrc,
  findHighlightForMatch,
  attachHighlights,
  mergeHighlightsIndex,
};
