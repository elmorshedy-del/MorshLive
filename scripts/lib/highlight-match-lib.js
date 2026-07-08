/**
 * Deterministic fixture matching for btolat / vortex titles — name + optional date.
 * No LLM; uses normalized Arabic + Levenshtein (same as arabic-team-resolver).
 */
const { normalizeArabic, levenshtein } = require("../arabic-team-resolver");

const AR_MONTHS = {
  يناير: 0,
  فبراير: 1,
  مارس: 2,
  ابريل: 3,
  أبريل: 3,
  إبريل: 3,
  مايو: 4,
  يونيو: 5,
  يوليو: 6,
  يوليو: 6,
  أغسط: 7,
  اغسط: 7,
  سبتمبر: 8,
  اكتوبر: 9,
  أكتوبر: 9,
  نوفمبر: 10,
  ديسمبر: 11,
};

function arabicSimilarity(a, b) {
  const x = normalizeArabic(a);
  const y = normalizeArabic(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) {
    return Math.min(x.length, y.length) / Math.max(x.length, y.length);
  }
  const max = Math.max(x.length, y.length);
  return Math.max(0, 1 - levenshtein(x, y) / max);
}

function uniqueTruthy(items) {
  return [...new Set(items.filter(Boolean))];
}

function teamArabicCandidates(match, side, arabicTeam) {
  const name = match && match[side];
  const ar = arabicTeam ? arabicTeam(name) : "";
  return uniqueTruthy([ar, name]);
}

function sideScore(titleTeam, candidates) {
  return Math.max(0, ...candidates.map((c) => arabicSimilarity(titleTeam, c)));
}

/** Parse `(11 يونيو 2026)` or `11-6-2026` from btolat titles. Returns YYYY-MM-DD or null. */
function parseTitleDate(title) {
  const t = String(title || "");
  const iso = t.match(/\((\d{4})-(\d{1,2})-(\d{1,2})\)/);
  if (iso) {
    const y = iso[1];
    const mo = String(iso[2]).padStart(2, "0");
    const d = String(iso[3]).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  const ar = t.match(/\((\d{1,2})\s+(يناير|فبراير|مارس|ابريل|أبريل|إبريل|مايو|يونيو|يوليو|أغسط|اغسط|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر)(?:\s+(\d{4}))?\)/i);
  if (ar) {
    const day = String(ar[1]).padStart(2, "0");
    const monthKey = ar[2].replace(/[إأ]/g, "ا");
    const month = AR_MONTHS[monthKey];
    const year = ar[3] || "2026";
    if (month == null) return null;
    return `${year}-${String(month + 1).padStart(2, "0")}-${day}`;
  }
  return null;
}

function kickoffDay(kickoffUtc) {
  if (!kickoffUtc) return null;
  const d = String(kickoffUtc).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function dateMatchesFixture(title, match, toleranceDays = 1) {
  const titleDay = parseTitleDate(title);
  const fixtureDay = kickoffDay(match?.kickoffUtc);
  if (!titleDay || !fixtureDay) return true;
  const a = Date.parse(`${titleDay}T12:00:00Z`);
  const b = Date.parse(`${fixtureDay}T12:00:00Z`);
  if (isNaN(a) || isNaN(b)) return true;
  const diffDays = Math.abs(a - b) / 86400000;
  return diffDays <= toleranceDays;
}

function scoreFixtureMatch(teams, match, arabicTeam) {
  if (!match?.home || !match?.away || !teams?.a || !teams?.b) return 0;
  const homeNames = teamArabicCandidates(match, "home", arabicTeam);
  const awayNames = teamArabicCandidates(match, "away", arabicTeam);
  const direct = sideScore(teams.a, homeNames) + sideScore(teams.b, awayNames);
  const reverse = sideScore(teams.a, awayNames) + sideScore(teams.b, homeNames);
  return Math.max(direct, reverse);
}

function scoreTitleMentions(title, match, arabicTeam) {
  if (!match?.home || !match?.away) return 0;
  const normTitle = normalizeArabic(title);
  if (!normTitle) return 0;
  let homeHit = 0;
  let awayHit = 0;
  for (const n of teamArabicCandidates(match, "home", arabicTeam)) {
    const norm = normalizeArabic(n);
    if (norm && normTitle.includes(norm)) homeHit = Math.max(homeHit, Math.min(1, norm.length / 4));
  }
  for (const n of teamArabicCandidates(match, "away", arabicTeam)) {
    const norm = normalizeArabic(n);
    if (norm && normTitle.includes(norm)) awayHit = Math.max(awayHit, Math.min(1, norm.length / 4));
  }
  return homeHit + awayHit;
}

/**
 * Pick best fixture key for a btolat title. Requires both teams (score >= minScore)
 * and kickoff date when present in title.
 */
function resolveFixtureKey(title, teams, matches, opts = {}) {
  const list = Array.isArray(matches) ? matches : [];
  const pairKeyFn = opts.pairKeyFn;
  const arabicTeam = opts.arabicTeam;
  const minScore = opts.minScore ?? 1.85;
  if (!list.length || !pairKeyFn) return null;

  const scored = [];
  if (teams?.a && teams?.b) {
    for (const m of list) {
      const score = scoreFixtureMatch(teams, m, arabicTeam);
      if (score < minScore) continue;
      if (!dateMatchesFixture(title, m, opts.toleranceDays ?? 1)) continue;
      scored.push({ score, key: m.key || pairKeyFn(m.home, m.away), match: m });
    }
  } else if (title) {
    for (const m of list) {
      const score = scoreTitleMentions(title, m, arabicTeam);
      if (score < minScore) continue;
      if (!dateMatchesFixture(title, m, opts.toleranceDays ?? 1)) continue;
      scored.push({ score, key: m.key || pairKeyFn(m.home, m.away), match: m });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.key || null;
}

function titleTeams(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  const m = /(?:اهداف|أهداف|ملخص)\s+مباراة\s+(.+?)(?:\s*\(|\s+ك[اأ]س)/i.exec(t);
  if (!m) return null;
  const chunk = m[1].replace(/[()]/g, " ").trim();
  const parts = chunk.split(/\s+و\s*/);
  if (parts.length < 2) return null;
  return { a: parts[0].trim(), b: parts[1].trim() };
}

module.exports = {
  resolveFixtureKey,
  parseTitleDate,
  dateMatchesFixture,
  scoreFixtureMatch,
  scoreTitleMentions,
  titleTeams,
  arabicSimilarity,
};
