/* ============================================================================
 * highlights-lib.js — ملخص المباراة (Arabic match summary) + Arabic-commentary
 * highlight clip.
 *
 * Text summary: a templated Arabic recap built entirely from data already in
 * the fixture (final score, teams, venue, league, commentator) — always
 * available for an ended match, no external source or network call needed.
 *
 * Highlight video: the point is Arabic commentary, not just any clip, so we
 * search YouTube (via the free YouTube Data API v3) for a highlights video
 * using an Arabic query and only accept a result whose title/description is
 * actually in Arabic script. Requires a free YOUTUBE_API_KEY — skipped
 * entirely when unset, so the site still ships Arabic text summaries with
 * zero extra config; we never show a highlight clip that isn't Arabic.
 *
 * We build the embed URL ourselves from a validated 11-char video id (never
 * trust a raw URL/HTML fragment from the API response), so a malformed or
 * unexpected response can't inject markup.
 * ==========================================================================*/
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

/** Sets m.summaryAr on every ended match. Pure, no network. */
function attachSummaries(matches) {
  for (const m of matches) {
    if (m.status !== "ended") continue;
    m.summaryAr = buildArabicSummary(m);
  }
}

/** Arabic search queries for highlight discovery — primary + fallbacks. */
function buildHighlightQueries(match, arabicFor) {
  const homeAr = arabicFor(match.home);
  const awayAr = arabicFor(match.away);
  return [
    `ملخص واهداف مباراة ${homeAr} و ${awayAr} تعليق عربي`,
    `ملخص مباراة ${homeAr} و ${awayAr} كأس العالم 2026`,
    `اهداف مباراة ${homeAr} ضد ${awayAr} تعليق عربي`,
  ];
}

/** Arabic search query biased toward Arabic-commentary highlight uploads. */
function buildHighlightQuery(match) {
  return buildHighlightQueries(match, arabicTeam)[0];
}

const ARABIC_RE = /[؀-ۿ]/;
const YOUTUBE_ID_RE = /^[\w-]{11}$/;

/** Picks the first YouTube search result that is genuinely in Arabic. */
function pickArabicVideo(items) {
  for (const item of items || []) {
    const videoId = item.id && item.id.videoId;
    if (!videoId || !YOUTUBE_ID_RE.test(videoId)) continue;
    const snippet = item.snippet || {};
    const text = `${snippet.title || ""} ${snippet.description || ""}`;
    if (!ARABIC_RE.test(text)) continue; // skip anything not actually Arabic
    return {
      videoUrl: `https://www.youtube.com/embed/${videoId}`,
      title: snippet.title || "",
      channelTitle: snippet.channelTitle || "",
      thumbnail: (snippet.thumbnails && snippet.thumbnails.medium && snippet.thumbnails.medium.url) || "",
      source: "youtube",
    };
  }
  return null;
}

module.exports = {
  buildArabicSummary,
  attachSummaries,
  buildHighlightQuery,
  buildHighlightQueries,
  pickArabicVideo,
  arabicTeam,
};
