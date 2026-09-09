/* ============================================================================
 * channel-overrides-lib.js — Apply a better channel source over the
 * commentator feed's guess.
 *
 * refresh-broadcasts.js rewrites commentaryIndex from almaghrebsport on every
 * run. Anything corrected by hand inside today.json is therefore discarded the
 * next time it runs — which is why corrections live in their own files and get
 * applied here, after the feed, on every run.
 *
 * Precedence, highest first:
 *   1. assets/data/manual-channel-overrides.json — hand-made, never generated
 *   2. assets/data/broadcast-overrides.json      — goal.com, rewritten whole
 *   3. the almaghrebsport commentator feed
 *
 * Overrides are keyed by ESPN fixture id, not by team pair: a pair key cannot
 * tell two legs of a tie apart, and the id is what the site routes on anyway.
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const { pairKey } = require("./commentators-lib.js");

const DATA_DIR = path.join(__dirname, "..", "assets", "data");
const MANUAL = path.join(DATA_DIR, "manual-channel-overrides.json");
const GENERATED = path.join(DATA_DIR, "broadcast-overrides.json");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * One id -> {channel, channelId, source} map from both override files.
 * The hand-made file is merged last so it wins, which is the whole reason it
 * is kept separate from the generated one.
 */
function loadChannelOverrides({ manualFile = MANUAL, generatedFile = GENERATED } = {}) {
  const out = new Map();
  const generated = readJson(generatedFile);
  for (const [id, row] of Object.entries(generated?.rows || {})) {
    if (row?.channelId) out.set(id, { ...row, source: generated.source || "generated" });
  }
  const manual = readJson(manualFile) || {};
  for (const [id, row] of Object.entries(manual)) {
    if (row?.channelId) out.set(id, { ...row, source: "manual" });
  }
  return out;
}

/**
 * Stamp the override onto the fixture and onto its commentary row.
 *
 * The commentary row is what today.json carries and what the watch page reads,
 * so correcting the fixture alone would leave the page on the feed's number.
 * Commentators are left exactly as the feed supplied them — almaghrebsport is
 * still the right source for those, it is only its channel guess that is not.
 */
function applyChannelOverrides(matches, commentaryIndex, overrides) {
  if (!overrides || !overrides.size) return 0;
  const rowsByKey = new Map((commentaryIndex || []).map((row) => [row.key, row]));
  let applied = 0;

  for (const match of matches || []) {
    const override = overrides.get(String(match.id));
    if (!override) continue;
    // An override that agrees with the fallback still has to be recorded. ESPN
    // seeds every fixture with beIN 1, so "already beIN 1" is the unknown case,
    // not a confirmed one, and leaving it unstamped would keep a channel we do
    // know marked contested and leave the next feed run free to move it.
    const changed = match.channelId !== override.channelId;
    match.channel = override.channel;
    match.channelId = override.channelId;
    match.channelBinding = "resolved";
    match.channelSource = override.source;
    if (changed) applied += 1;

    const row = rowsByKey.get(pairKey(match.home, match.away));
    if (row) {
      row.channel = override.channel;
      row.channelId = override.channelId;
      row.channelBinding = "resolved";
      row.channelSource = override.source;
    } else {
      commentaryIndex.push({
        key: pairKey(match.home, match.away),
        home: match.home,
        away: match.away,
        commentators: match.commentators || [],
        channel: override.channel,
        channelId: override.channelId,
        channelBinding: "resolved",
        channelSource: override.source,
      });
    }
  }

  return applied;
}

module.exports = { loadChannelOverrides, applyChannelOverrides, MANUAL, GENERATED };
