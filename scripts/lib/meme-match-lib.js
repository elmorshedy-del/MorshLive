/**
 * Deterministic meme ↔ fixture matching (name + kickoff window). No LLM.
 */

function normTeam(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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

/** Both teams must appear in caption for a confident match (score >= 2). */
function memeCaptionScore(text, home, away, match) {
  const t = normTeam(text);
  if (!t) return 0;
  let score = 0;
  const homeNorm = normTeam(home);
  const awayNorm = normTeam(away);
  if (homeNorm.length > 2 && t.includes(homeNorm)) score += 1;
  if (awayNorm.length > 2 && t.includes(awayNorm)) score += 1;
  for (const p of playerNamesFromMatch(match)) {
    const pn = normTeam(p);
    if (pn.length > 3 && t.includes(pn)) score += 0.25;
  }
  return score;
}

function memeCaptionMatches(text, home, away, match) {
  return memeCaptionScore(text, home, away, match) >= 2;
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

function bestMemeMatchKey(text, matches) {
  let best = null;
  for (const m of matches || []) {
    if (!m?.home || !m?.away) continue;
    const score = memeCaptionScore(text, m.home, m.away, m);
    if (score < 2) continue;
    const kickoff = Date.parse(m.kickoffUtc || "");
    const tieBreak = isNaN(kickoff) ? 0 : kickoff;
    if (!best || score > best.score || (score === best.score && tieBreak > best.tieBreak)) {
      best = { key: m.key || `${normTeam(m.home).replace(/\s+/g, "")}~${normTeam(m.away).replace(/\s+/g, "")}`, score, tieBreak, match: m };
    }
  }
  return best?.key || null;
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
  return [...(memes || [])].map((m, i) => ({ ...m, _order: i }))
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
  memeCaptionMatches,
  memePostWindow,
  memeInWindow,
  bestMemeMatchKey,
  attachMatchMeta,
  orderMemesChronological,
};
