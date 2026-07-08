/**
 * Deterministic meme ↔ fixture matching (name + kickoff window). No LLM.
 * Allows one team, player, or moment caption when the match is unambiguous.
 */

const MOMENT_TERMS = [
  "referee",
  "var",
  "penalty",
  "red card",
  "save",
  "keeper",
  "goalkeeper",
  "highlights",
  "miss",
  "chance",
  "highlights",
  "ملخص",
  "هدف",
  "تصدي",
  "حارس",
  "حكم",
  "طرد",
  "جزاء",
  "فرصة",
  "عارضة",
];

function normText(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normTeam(s) {
  return normText(s);
}

function playerNamesFromMatch(match) {
  const names = [];
  const push = (n) => {
    const s = String(n || "").trim();
    if (s.length > 2 && !names.includes(s)) names.push(s);
  };
  for (const side of ["home", "away"]) {
    const lu = match?.lineups?.[side];
    if (!lu) continue;
    for (const band of ["starters", "subs", "bench"]) {
      for (const p of lu[band] || []) push(p.name);
    }
  }
  return names;
}

function teamHit(text, name) {
  const t = normText(text);
  const n = normTeam(name);
  if (!t || n.length <= 2) return 0;
  if (t.includes(n)) return 1;
  return 0;
}

function playerHitScore(text, match) {
  const t = normText(text);
  if (!t) return 0;
  let best = 0;
  for (const p of playerNamesFromMatch(match)) {
    const pn = normTeam(p);
    if (pn.length > 3 && t.includes(pn)) best = Math.max(best, 1);
    const parts = pn.split(/\s+/).filter((w) => w.length >= 4);
    for (const w of parts) {
      if (t.includes(w)) best = Math.max(best, 0.8);
    }
  }
  return best;
}

function momentHit(text) {
  const t = normText(text);
  return MOMENT_TERMS.some((term) => t.includes(normText(term)));
}

/** Rich caption score for one fixture. */
function memeCaptionScoreDetailed(text, home, away, match) {
  const homeHit = teamHit(text, home);
  const awayHit = teamHit(text, away);
  const player = playerHitScore(text, match);
  const moment = momentHit(text) ? 0.35 : 0;
  const teams = homeHit + awayHit;
  const total = teams + player + moment;
  return { total, teams, homeHit, awayHit, player, moment };
}

function memeCaptionScore(text, home, away, match) {
  return memeCaptionScoreDetailed(text, home, away, match).total;
}

/**
 * Match caption to a known fixture (post-match window already applied by caller).
 * One team, player, or moment + team/player is enough.
 */
function memeCaptionMatches(text, home, away, match) {
  const s = memeCaptionScoreDetailed(text, home, away, match);
  if (s.homeHit && s.awayHit) return true;
  if (s.homeHit || s.awayHit) return true;
  if (s.player >= 0.8) return true;
  if (s.moment && (s.homeHit || s.awayHit || s.player >= 0.8)) return true;
  return false;
}

function isUnambiguousWinner(top, second) {
  if (!top) return false;
  if (top.homeHit && top.awayHit) return true;
  if (top.player >= 0.8 && (!second || top.player > second.player + 0.1)) return true;
  if (top.teams >= 1 && (!second || top.total >= second.total + 0.45)) return true;
  if (top.moment && top.teams >= 1 && (!second || top.total >= second.total + 0.35)) return true;
  return false;
}

function memePostWindow(kickoffUtc, opts = {}) {
  const kickoff = Date.parse(kickoffUtc || "");
  if (isNaN(kickoff)) return null;
  const now = Date.now();
  const matchMs = opts.matchMs ?? 105 * 60 * 1000;
  const lookbackMs = opts.lookbackMs ?? 15 * 60 * 1000;
  const contextMs = opts.contextMs ?? 72 * 60 * 60 * 1000;
  const contextEnd = kickoff + contextMs;
  return {
    start: new Date(kickoff - lookbackMs).toISOString(),
    end: new Date(Math.min(Math.max(now, kickoff + matchMs), contextEnd)).toISOString(),
  };
}

function memeInWindow(createdAt, window) {
  if (!window || !createdAt) return false;
  const t = Date.parse(createdAt);
  return t >= Date.parse(window.start) && t <= Date.parse(window.end);
}

function matchPairKey(m) {
  const norm = (s) => normTeam(s).replace(/[^a-z0-9]/g, "");
  return m.key || [norm(m.home), norm(m.away)].filter(Boolean).sort().join("~");
}

/** Pick fixture for universal captions — only when one game clearly wins. */
function bestMemeMatchKey(text, matches) {
  const ranked = (matches || [])
    .filter((m) => m?.home && m?.away)
    .map((m) => {
      const s = memeCaptionScoreDetailed(text, m.home, m.away, m);
      return { key: matchPairKey(m), score: s.total, ...s, match: m };
    })
    .filter((r) => r.total >= 0.8)
    .sort((a, b) => b.score - a.score || (Date.parse(b.match.kickoffUtc || "") - Date.parse(a.match.kickoffUtc || "")));

  if (!ranked.length) return null;
  const top = ranked[0];
  const second = ranked[1];
  return isUnambiguousWinner(top, second) ? top.key : null;
}

function attachMatchMeta(meme, match) {
  if (!match) return meme;
  return {
    ...meme,
    home: match.home || meme.home || null,
    away: match.away || meme.away || null,
    score: match.score || meme.score || null,
    kickoffUtc: match.kickoffUtc || meme.kickoffUtc || null,
  };
}

/** Preserve syndication fetch order; tie-break by postedAt desc. */
function orderMemesChronological(memes) {
  return [...(memes || [])]
    .map((m, i) => ({ ...m, _order: i }))
    .sort((a, b) => {
      const ta = Date.parse(a.postedAt || "") || 0;
      const tb = Date.parse(b.postedAt || "") || 0;
      if (tb !== ta) return tb - ta;
      return (a._order || 0) - (b._order || 0);
    })
    .map(({ _order, ...m }) => m);
}

module.exports = {
  memeCaptionScore,
  memeCaptionScoreDetailed,
  memeCaptionMatches,
  memePostWindow,
  memeInWindow,
  bestMemeMatchKey,
  attachMatchMeta,
  orderMemesChronological,
  playerHitScore,
  momentHit,
};
