/* ============================================================================
 * goal-broadcasts-lib.js — Pure helpers for reading beIN channel assignments
 * off goal.com.
 *
 * Why this source exists alongside almaghrebsport: almaghrebsport is a
 * commentator feed. It names a commentator reliably and a channel number only
 * incidentally, and when it guesses it guesses "beIN 1" — which is how a
 * Champions League tie on beIN 4 reached the site labelled beIN 1. goal.com
 * publishes the broadcaster's own listing and gets the number right.
 *
 * Two things about goal.com decide whether a request returns anything:
 *   - listings are geo-scoped, so requests must carry a Saudi hint;
 *   - only the ar-sa edition carries the MENA (beIN) listing. The en-ae edition
 *     answers with an empty tvChannels array even from a Saudi address.
 * The slug in an ar-sa match URL is decorative — the id resolves the page — so
 * a placeholder stands in for the Arabic slug we cannot construct.
 *
 * goal.com publishes a fixture's channel roughly two to three days out, not a
 * full week, so a run covering seven days will legitimately return channels for
 * the near days and nothing for the far ones. That is the source's horizon, not
 * a failure, and it is why this runs on a schedule instead of once.
 * ==========================================================================*/

/* Youth, reserve and women's sides share their parent club's name and often
   kick off within the same window on the same day. Pairing on names alone would
   bind a Champions League tie to the Youth League fixture played hours earlier
   on the same pitch, so these are refused before any name comparison. */
const NON_SENIOR = /\b(u\s?1[5-9]|u\s?2[0-3]|under\s?\d{2}|academy|youth|reserves?|women|ladies|femin\w*|fem|w)\b/i;

function isNonSeniorTeam(name) {
  return NON_SENIOR.test(String(name || ""));
}

/* Fold the spelling differences between ESPN and goal.com — accents, club-type
   noise — without folding two different clubs together. */
function normalizeTeam(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|cf|sc|fk|afc|ac|as|ss|ssc|rc|cd|ud|sv|vfb|club|de|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when two names denote the same club.
 *
 * Containment is allowed in both directions — goal.com writes "SSC Napoli" and
 * "Deportivo Alaves" where ESPN writes "Napoli" and "Alavés", and ESPN writes
 * "Bayern Munich" where goal.com writes "Bayern" — but only on whole words and
 * only from four characters up. "Manchester United" and "Manchester City"
 * contain neither the other, so the loosening does not reach them.
 */
function sameTeam(a, b) {
  const x = normalizeTeam(a);
  const y = normalizeTeam(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [long, short] = x.length >= y.length ? [x, y] : [y, x];
  if (short.length < 4) return false;
  return new RegExp(`(^| )${short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(long);
}

/**
 * The Arabic MENA feed out of a goal.com tvChannels list.
 *
 * goal.com lists every edition a fixture airs on — "beIN SPORTS 3" alongside
 * "beIN SPORTS EN 1" and "beIN Sports FR 2". Only the untagged name is the
 * Arabic channel this site streams; the EN and FR entries are separate feeds
 * carrying separate numbering, and taking one would send an Arabic viewer to an
 * English commentary channel with a number that means nothing here.
 */
/* Only the channels assets/js/data.js models. Naming one it does not is worse
   than naming none: resolveWatchSelection falls back to channels[0] for the row
   while mountLabChannel mounts match.channelId directly, so the card shows one
   channel and the player asks the lab for another. beIN 5-9 reached viewers that
   way and drained instead of buffering. Widen this only together with
   CHANNEL_DEFS, and only once the feed is confirmed to deliver video. */
const ROUTABLE_SPORTS = 4;
const ROUTABLE_MAX = 4;

function pickArabicBeinChannel(names) {
  for (const raw of Array.isArray(names) ? names : []) {
    const name = String(raw || "").replace(/\s+/g, " ").trim();
    const max = /^bein\s+sports?\s+max\s+([1-9])$/i.exec(name);
    if (max) {
      if (Number(max[1]) > ROUTABLE_MAX) continue;
      return { channel: `beIN Max ${max[1]}`, channelId: `bein-max-${max[1]}` };
    }
    const sports = /^bein\s+sports?\s+([1-9])$/i.exec(name);
    if (sports) {
      if (Number(sports[1]) > ROUTABLE_SPORTS) continue;
      return { channel: `beIN Sports ${sports[1]}`, channelId: `bein-sports-${sports[1]}` };
    }
  }
  return null;
}

/**
 * Pair one of our fixtures against goal.com's listing for the same day.
 *
 * Kickoff is the primary key and the names only confirm it: goal.com and ESPN
 * agree on the instant, and requiring both to agree on both teams as well is
 * what keeps a same-slot fixture from another competition out.
 */
function findGoalFixture(fixture, goalRows, { toleranceMinutes = 15 } = {}) {
  const want = Date.parse(fixture.kickoffUtc);
  if (!Number.isFinite(want)) return null;
  const window = toleranceMinutes * 60 * 1000;
  return (
    (goalRows || []).find((row) => {
      if (isNonSeniorTeam(row.home) || isNonSeniorTeam(row.away)) return false;
      const when = Date.parse(row.start);
      if (!Number.isFinite(when) || Math.abs(when - want) > window) return false;
      return sameTeam(row.home, fixture.home) && sameTeam(row.away, fixture.away);
    }) || null
  );
}

module.exports = {
  isNonSeniorTeam,
  normalizeTeam,
  sameTeam,
  pickArabicBeinChannel,
  findGoalFixture,
};
