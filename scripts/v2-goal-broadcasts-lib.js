/* ============================================================================
 * v2-goal-broadcasts-lib.js — fail-closed Goal.com fallback for V2 beIN.
 *
 * FilGoal remains the primary broadcaster source. These helpers are used only
 * for fixtures that FilGoal did not resolve to a concrete V2 beIN channel.
 * Goal matching requires both senior-team names and kickoff to agree; ambiguous
 * matches return null rather than guessing.
 * ==========================================================================*/
const { parseBeinChannel } = require("./v2-bein-bindings-lib.js");

const NON_SENIOR = /\b(u\s?1[5-9]|u\s?2[0-3]|under\s?\d{2}|academy|youth|reserves?|women|ladies|femin\w*|fem|w)\b/i;

function isNonSeniorTeam(name) {
  return NON_SENIOR.test(String(name || ""));
}

function normalizeTeam(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|cf|sc|fk|afc|ac|as|ss|ssc|rc|cd|ud|sv|vfb|club|de|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameTeam(a, b) {
  const x = normalizeTeam(a);
  const y = normalizeTeam(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const long = x.length >= y.length ? x : y;
  const short = x.length >= y.length ? y : x;
  if (short.length < 4) return false;
  const escaped = short.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  return new RegExp("(^| )" + escaped + "( |$)").test(long);
}

function nextData(html) {
  const match = String(html || "").match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function collectGoalFixtures(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const value of node) collectGoalFixtures(value, out);
    return out;
  }
  if (node.link?.pageType === "MATCH" && node.startDate) {
    out.push({
      id: node.link.id,
      start: node.startDate,
      home: node.teamA?.name || null,
      away: node.teamB?.name || null,
    });
  }
  for (const value of Object.values(node)) collectGoalFixtures(value, out);
  return out;
}

function collectGoalTvChannels(node) {
  let found = [];
  (function walk(value) {
    if (!value || typeof value !== "object" || found.length) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (Array.isArray(value.tvChannels) && value.tvChannels.length) {
      found = value.tvChannels.map((channel) => channel?.name).filter(Boolean);
      return;
    }
    for (const child of Object.values(value)) walk(child);
  })(node);
  return found;
}

function findGoalFixture(fixture, goalRows, { toleranceMinutes = 15 } = {}) {
  const want = Date.parse(fixture?.kickoffUtc || "");
  if (!Number.isFinite(want) || isNonSeniorTeam(fixture?.home) || isNonSeniorTeam(fixture?.away)) {
    return null;
  }
  const windowMs = toleranceMinutes * 60000;
  const hits = (goalRows || []).filter((row) => {
    if (isNonSeniorTeam(row?.home) || isNonSeniorTeam(row?.away)) return false;
    const when = Date.parse(row?.start || "");
    if (!Number.isFinite(when) || Math.abs(when - want) > windowMs) return false;
    return sameTeam(row?.home, fixture.home) && sameTeam(row?.away, fixture.away);
  });
  return hits.length === 1 ? hits[0] : null;
}

function pickGoalBeinChannel(names, vegaCatalog) {
  for (const raw of Array.isArray(names) ? names : []) {
    const parsed = parseBeinChannel(raw);
    if (!parsed?.key || !vegaCatalog?.channels?.[parsed.key]?.streamId) continue;
    return parsed;
  }
  return null;
}

module.exports = {
  isNonSeniorTeam,
  normalizeTeam,
  sameTeam,
  nextData,
  collectGoalFixtures,
  collectGoalTvChannels,
  findGoalFixture,
  pickGoalBeinChannel,
};
