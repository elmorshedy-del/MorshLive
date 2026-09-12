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

function fuzzyThreshold(len) {
  return Math.max(2, Math.ceil(len * 0.22));
}

function resolveArabicTeam(ar, index) {
  const raw = String(ar || "").trim();
  if (!raw) return null;

  const norm = normalizeArabic(raw);
  if (!norm) return null;

  if (index.exact.has(norm)) return index.exact.get(norm);

  const compact = norm.replace(/\s+/g, "");
  if (index.exact.has(compact)) return index.exact.get(compact);

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
