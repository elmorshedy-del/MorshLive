/* ============================================================================
 * arabic-team-resolver.js — Arabic team name → English via normalization +
 * Levenshtein fuzzy match (no LLM, no hardcoded alias tables).
 *
 * Source of truth: assets/data/team-names-ar.json (en → ar).
 * Spelling variants (hamza, typos) are resolved algorithmically.
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");

const DEFAULT_TEAM_AR = path.join(__dirname, "..", "assets", "data", "team-names-ar.json");

function normalizeArabic(s) {
  return (s || "")
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .replace(/[^\u0621-\u064A]/g, "")
    .replace(/^ال/, "");
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

function canonicalEnglish(en) {
  const s = String(en || "").trim();
  if (s === "USA" || s === "UAE") return s === "USA" ? "United States" : "United Arab Emirates";
  if (s === "DR Congo") return "Congo DR";
  if (s === "Czech Republic") return "Czechia";
  if (s === "Korea Republic") return "South Korea";
  if (s === "Cote d'Ivoire") return "Ivory Coast";
  return s;
}

function buildTeamIndex(teamArJson) {
  const exact = new Map();
  const fuzzy = [];
  const seen = new Set();

  for (const [en, ar] of Object.entries(teamArJson || {})) {
    const canonical = canonicalEnglish(en);
    const norm = normalizeArabic(ar);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    exact.set(norm, canonical);
    fuzzy.push({ norm, en: canonical });
  }

  return { exact, fuzzy };
}

/**
 * How far a spelling may drift and still be the same club.
 *
 * A flat floor of 2 was far too generous for short names: two edits on a three
 * or four letter word reaches most of the alphabet, so "ليل" (Lille) landed on
 * "ويلز" (Wales), "بوكا" (Boca) on Panama, and "زد" (the Egyptian club ZED) on
 * Al Hazem — a Saudi club, whose match would then inherit an Egyptian channel.
 * An invented match is worse than none: a miss leaves the fixture unhydrated,
 * where a wrong hit binds it to another competition's stream. Short names must
 * therefore be spelled correctly; only longer ones have room for variants.
 */
function fuzzyThreshold(len) {
  if (len <= 4) return 0;
  if (len <= 7) return 1;
  return Math.ceil(len * 0.22);
}

/**
 * The feed writes short forms — "لاسك" for لاسك لينتس, "دورتموند" for بوروسيا
 * دورتموند, "نيوكاسل" for نيوكاسل يونايتد — all of which are in the dictionary
 * under their full names and are far beyond any sane edit distance from them.
 * Accept a name that is contained in exactly one entry: containment is a much
 * stronger signal than distance, and the single-candidate rule keeps a shared
 * fragment from picking a club at random.
 */
function containedMatch(norm, index) {
  if (norm.length < 4) return null;
  let found = null;
  for (const { norm: candidate, en } of index.fuzzy) {
    // Both sides must be long enough to be distinctive. A short entry such as
    // "ليل" would otherwise be swallowed by any longer name containing it.
    if (candidate.length < 4) continue;
    if (!candidate.includes(norm) && !norm.includes(candidate)) continue;
    if (found && found !== en) return null;
    found = en;
  }
  return found;
}

function resolveArabicTeam(ar, index) {
  const raw = String(ar || "").trim();
  if (!raw) return null;

  const norm = normalizeArabic(raw);
  if (!norm) return null;

  if (index.exact.has(norm)) return index.exact.get(norm);

  const compact = norm.replace(/\s+/g, "");
  if (index.exact.has(compact)) return index.exact.get(compact);

  const contained = containedMatch(norm, index);
  if (contained) return contained;

  let best = null;
  let bestDist = Infinity;
  for (const { norm: candidate, en } of index.fuzzy) {
    const dist = levenshtein(norm, candidate);
    const limit = fuzzyThreshold(Math.max(norm.length, candidate.length));
    if (dist <= limit && dist < bestDist) {
      bestDist = dist;
      best = en;
    }
  }
  return best;
}

function createArabicTeamResolver(teamArPath = DEFAULT_TEAM_AR) {
  const json = JSON.parse(fs.readFileSync(teamArPath, "utf8"));
  const index = buildTeamIndex(json);
  return (ar) => resolveArabicTeam(ar, index);
}

module.exports = {
  normalizeArabic,
  levenshtein,
  buildTeamIndex,
  resolveArabicTeam,
  createArabicTeamResolver,
};
