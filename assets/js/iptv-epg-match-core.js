/* Pure deterministic fixture -> provider EPG matcher.
 * Extracted from iptv-epg-auto.js so the primary broadcaster router can use
 * the same fail-closed scoring as a fallback without installing a second DOM
 * router. BOTH teams must match and program timing must be coherent.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KZIptvEpgMatcherCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const MIN_SCORE = 165;
  const AMBIGUITY_MARGIN = 15;
  const TEAM_NOISE = new Set(["fc", "sc", "cf", "club", "football", "soccer", "team"]);

  function normalize(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function compactTeam(value) {
    return normalize(value)
      .split(" ")
      .filter(Boolean)
      .filter((token) => !TEAM_NOISE.has(token))
      .join(" ");
  }

  function teamForms(name, aliases) {
    const values = [name, ...(Array.isArray(aliases) ? aliases : [])];
    const forms = new Set();
    for (const value of values) {
      const normalized = normalize(value);
      const compact = compactTeam(value);
      if (normalized.length >= 3) forms.add(normalized);
      if (compact.length >= 3) forms.add(compact);
    }
    return [...forms].sort((a, b) => b.length - a.length);
  }

  function teamScore(programText, forms) {
    const text = ` ${normalize(programText)} `;
    for (const form of forms) {
      if (text.includes(` ${form} `) || text.includes(form)) return 80;
    }
    return 0;
  }

  function timestampMs(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number) || number <= 0) return NaN;
    return number < 1e12 ? number * 1000 : number;
  }

  function programMatchScore(match, program) {
    if (!match || !program?.logicalKey) return Number.NEGATIVE_INFINITY;
    const programText = `${program.title || ""} ${program.description || ""}`.trim();
    if (!programText) return Number.NEGATIVE_INFINITY;

    const homeScore = teamScore(programText, teamForms(match.home, match.homeAliases));
    const awayScore = teamScore(programText, teamForms(match.away, match.awayAliases));
    if (!homeScore || !awayScore) return Number.NEGATIVE_INFINITY;

    let score = homeScore + awayScore;
    const kickoff = Date.parse(match.kickoffUtc || "");
    const start = timestampMs(program.startTimestamp);
    const stop = timestampMs(program.stopTimestamp);

    if (match.status === "live" && program.nowPlaying) score += 35;

    if (Number.isFinite(kickoff) && Number.isFinite(start)) {
      if (Number.isFinite(stop) && kickoff >= start - 45 * 60 * 1000 && kickoff <= stop + 45 * 60 * 1000) {
        score += 30;
      } else {
        const delta = Math.abs(start - kickoff);
        if (delta <= 90 * 60 * 1000) score += 20;
        else if (delta <= 3 * 60 * 60 * 1000) score += 5;
        else return Number.NEGATIVE_INFINITY;
      }
    }

    return score;
  }

  function resolveProgramMatch(match, programs) {
    const byLogicalKey = new Map();
    for (const program of Array.isArray(programs) ? programs : []) {
      const score = programMatchScore(match, program);
      if (!Number.isFinite(score)) continue;
      const key = String(program.logicalKey || "");
      const previous = byLogicalKey.get(key);
      if (!previous || score > previous.score) byLogicalKey.set(key, { program, score });
    }

    const ranked = [...byLogicalKey.values()].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.program.logicalKey).localeCompare(String(b.program.logicalKey), "en", { numeric: true });
    });
    if (!ranked.length || ranked[0].score < MIN_SCORE) return null;
    if (ranked[1] && ranked[0].score - ranked[1].score < AMBIGUITY_MARGIN) return null;
    return ranked[0];
  }

  return {
    MIN_SCORE,
    AMBIGUITY_MARGIN,
    normalize,
    compactTeam,
    programMatchScore,
    resolveProgramMatch,
  };
});
