/* Auto-generate per-match poll config for live + upcoming fixtures. */
const fs = require("fs");
const path = require("path");
const { arabicTeam } = require("./highlights-lib");

const POLL_JSON = path.join(__dirname, "..", "assets", "data", "match-poll.json");

function teamKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function buildPollEntry(match) {
  const homeKey = teamKey(match.home);
  const awayKey = teamKey(match.away);
  if (!match.id || !homeKey || !awayKey) return null;
  return {
    pollId: match.id,
    matchIds: [match.id],
    homeKey,
    awayKey,
    teams: {
      [homeKey]: { nameAr: arabicTeam(match.home), nameEn: match.home },
      [awayKey]: { nameAr: arabicTeam(match.away), nameEn: match.away },
    },
  };
}

function buildPollConfig(matches) {
  const polls = (matches || [])
    .filter((m) => m && (m.status === "live" || m.status === "upcoming"))
    .map(buildPollEntry)
    .filter(Boolean);
  return {
    enabled: true,
    titleAr: "تتوقع من؟",
    titleEn: "Who do you think wins?",
    polls,
  };
}

function writePollConfig(matches) {
  const doc = buildPollConfig(matches);
  fs.mkdirSync(path.dirname(POLL_JSON), { recursive: true });
  fs.writeFileSync(POLL_JSON, JSON.stringify(doc, null, 2) + "\n");
  return doc;
}

module.exports = { buildPollConfig, buildPollEntry, writePollConfig, teamKey, POLL_JSON };
