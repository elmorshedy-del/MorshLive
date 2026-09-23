/* ============================================================================
 * commentators-lib.js — Parse + join Arabic match commentators (المعلّق).
 *
 * Full coverage source: almaghrebsport.com/commentators (daily, all leagues).
 * Markup is stable divs: .mt-match > (.mt-team, .mt-time, .mt-team) + .mt-info
 * (.mt-commentator, .mt-channel). Matches with multiple broadcast channels can
 * repeat, so we aggregate every commentator/channel per team-pair.
 *
 * Fixtures come from ESPN/TheSportsDB in English, the source is Arabic, so we
 * join by team name via fuzzy Arabic resolver (team-names-ar.json).
 * ==========================================================================*/
const path = require("path");
const { createArabicTeamResolver, normalizeArabic } = require("./arabic-team-resolver");
const {
  broadcastMetadata,
  defaultSaudiBroadcast,
  isSaudiProLeagueMatch,
  resolveBroadcastChannel,
} = require("./broadcast-registry");

const TEAM_AR_PATH = path.join(__dirname, "..", "assets", "data", "team-names-ar.json");
let _arabicResolver = null;

function arabicTeamToEnglish(ar) {
  if (!_arabicResolver) _arabicResolver = createArabicTeamResolver(TEAM_AR_PATH);
  return _arabicResolver(ar);
}

function normalizeEnglish(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function pairKey(enHome, enAway) {
  return [normalizeEnglish(enHome), normalizeEnglish(enAway)].sort().join("~");
}

function prettyChannel(ar) {
  return resolveBroadcastChannel(ar).channel;
}

function pick(re, segment) {
  const m = segment.match(re);
  return m ? m[1].trim() : "";
}

function pickAll(re, segment) {
  const out = [];
  let m;
  const g = new RegExp(re.source, "g");
  while ((m = g.exec(segment))) out.push(m[1].trim());
  return out;
}

function parseCommentators(html) {
  if (!html) return [];
  const rows = [];
  const blocks = String(html).split(/class="mt-match"/).slice(1);
  for (const raw of blocks) {
    const segment = raw.split(/class="mt-footer"/)[0];
    const teams = pickAll(/mt-team">([^<]+)</, segment);
    if (teams.length < 2) continue;
    const time = pick(/mt-time">([^<]+)</, segment);
    const commentatorNames = pickAll(/mt-commentator">([^<]+)</, segment);
    const channelNames = pickAll(/mt-channel">([^<]+)</, segment)
      .map(prettyChannel)
      .filter(Boolean);
    const infos = commentatorNames
      .map((name, i) => ({
        name: name.trim(),
        channel: channelNames[i] || "",
      }))
      .filter((x) => x.name);
    if (!infos.length && !channelNames.length) continue;
    rows.push({
      homeAr: teams[0],
      awayAr: teams[1],
      time,
      infos,
      channels: channelNames,
    });
  }
  return rows;
}

function buildIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const enHome = arabicTeamToEnglish(row.homeAr);
    const enAway = arabicTeamToEnglish(row.awayAr);
    if (!enHome || !enAway) continue;
    const key = pairKey(enHome, enAway);
    const entry = index.get(key) || {
      commentators: [],
      channels: [],
      seenCommentators: new Set(),
      seenChannels: new Set(),
    };
    for (const channel of row.channels || []) {
      if (!channel || entry.seenChannels.has(channel)) continue;
      entry.seenChannels.add(channel);
      entry.channels.push(channel);
    }
    for (const info of row.infos) {
      const dedupe = `${info.name}|${info.channel}`;
      if (entry.seenCommentators.has(dedupe)) continue;
      entry.seenCommentators.add(dedupe);
      entry.commentators.push(info);
    }
    index.set(key, entry);
  }
  return index;
}

function broadcastFor(entry) {
  for (const channel of entry?.channels || []) {
    const resolved = resolveBroadcastChannel(channel);
    if (resolved.channel) return resolved;
  }
  for (const item of entry?.commentators || []) {
    if (!item?.channel) continue;
    const resolved = resolveBroadcastChannel(item.channel);
    if (resolved.channel) return resolved;
  }
  return resolveBroadcastChannel("");
}

/* Playback routing remains intentionally narrower than broadcast metadata.
   beIN labels map to the existing playable registry. Saudi Thmanyah labels are
   recorded as real broadcast channels but do not silently route into a beIN
   stream; that is a separate concern handled by the stream registry. */
function channelIdFor(entry, match) {
  const resolved = broadcastFor(entry);
  if (resolved.playbackChannelId) return resolved.playbackChannelId;
  if (isSaudiProLeagueMatch(match)) return null;
  return "bein-sports-1";
}

/* Whether channelIdFor actually knew the channel, or just defaulted. The watch
   page needs to tell those apart: a defaulted binding routinely puts several
   simultaneous matches on beIN Sports 1, and all but one of them then play the
   wrong game. Mirrors lib/channel-binding.js — see that file for the reasoning. */
function channelBindingFor(entry) {
  return broadcastFor(entry).playbackChannelId ? "resolved" : "fallback";
}

function channelNameFor(entry, channelId) {
  const resolved = broadcastFor(entry);
  if (resolved.channel) return resolved.channel;
  if (/^bein-max-(\d)$/.test(channelId || "")) return `beIN MAX ${channelId.slice(-1)}`;
  return channelId === "bein-sports-2" ? "beIN Sports 2" : "beIN Sports 1";
}

function sourceBroadcastFor(entry) {
  const resolved = broadcastFor(entry);
  return broadcastMetadata(resolved, "almaghrebsport");
}

function clearSaudiPlaybackRoute(match, row) {
  delete match.channelId;
  if (row) delete row.channelId;
}

function ensureSaudiBroadcastFallback(matches, commentaryIndex) {
  const rowsByKey = new Map((commentaryIndex || []).map((row) => [row.key, row]));
  let hydrated = 0;

  for (const match of matches || []) {
    if (!isSaudiProLeagueMatch(match)) continue;
    const key = pairKey(match.home, match.away);
    const row = rowsByKey.get(key);
    const sourceResolved = resolveBroadcastChannel(row?.channel || match.channel || "");

    if (sourceResolved.provider === "thmanyah") {
      const broadcast =
        row?.broadcast ||
        match.broadcast ||
        broadcastMetadata(sourceResolved, row ? "almaghrebsport" : "fixture-cache");
      match.channel = sourceResolved.channel;
      if (broadcast) match.broadcast = broadcast;
      if (row) {
        row.channel = sourceResolved.channel;
        if (broadcast) row.broadcast = broadcast;
      }
      clearSaudiPlaybackRoute(match, row);
      continue;
    }

    const broadcast = defaultSaudiBroadcast();
    match.channel = "ثمانية";
    match.broadcast = broadcast;
    clearSaudiPlaybackRoute(match, row);

    if (row) {
      row.channel = "ثمانية";
      row.broadcast = broadcast;
    } else {
      const fallbackRow = {
        key,
        home: match.home,
        away: match.away,
        commentators: [],
        channel: "ثمانية",
        broadcast,
      };
      commentaryIndex.push(fallbackRow);
      rowsByKey.set(key, fallbackRow);
    }
    hydrated++;
  }

  return hydrated;
}

/* Attach commentator + channel data to fixtures; returns a compact index for
   the JSON cache so the browser can re-attach onto live API results. Channel
   hydration does not wait for a commentator name; a published channel alone
   is enough to update the card before kickoff. */
function attachCommentators(matches, html) {
  const index = buildIndex(parseCommentators(html));
  const commentaryIndex = [];
  let matched = 0;
  for (const m of matches) {
    const entry = index.get(pairKey(m.home, m.away));
    if (!entry || (!entry.commentators.length && !entry.channels.length)) continue;
    matched++;
    const channelId = channelIdFor(entry, m);
    const channelName = channelNameFor(entry, channelId);
    const broadcast = sourceBroadcastFor(entry);
    if (entry.commentators.length) {
      m.commentators = entry.commentators;
      m.commentator = entry.commentators[0].name;
    }
    m.channel = channelName;
    if (channelId) {
      m.channelId = channelId;
      m.channelBinding = channelBindingFor(entry);
    } else if (isSaudiProLeagueMatch(m)) {
      delete m.channelId;
      delete m.channelBinding;
    }
    if (broadcast) m.broadcast = broadcast;
    commentaryIndex.push({
      key: pairKey(m.home, m.away),
      home: m.home,
      away: m.away,
      commentators: entry.commentators,
      channel: channelName,
      ...(channelId ? { channelId, channelBinding: channelBindingFor(entry) } : {}),
      ...(broadcast ? { broadcast } : {}),
    });
  }

  ensureSaudiBroadcastFallback(matches, commentaryIndex);
  markContestedBindings(matches);
  return { matched, commentaryIndex };
}

/* One channel cannot carry two simultaneous matches, so when an unverified
   binding collides with another the page must not claim it is the right one.
   Mirrors lib/channel-binding.js (ESM; this file is CommonJS). */
const OVERLAP_MINUTES = 105;

function markContestedBindings(matches) {
  const rows = Array.isArray(matches) ? matches : [];
  const byChannel = new Map();
  for (const match of rows) {
    if (!match?.channelId) continue;
    if (!byChannel.has(match.channelId)) byChannel.set(match.channelId, []);
    byChannel.get(match.channelId).push(match);
  }
  const kickoffMs = (match) => {
    const ms = Date.parse(String(match?.kickoffUtc || ""));
    return Number.isFinite(ms) ? ms : Number.NaN;
  };
  for (const group of byChannel.values()) {
    if (group.length < 2) continue;
    for (const match of group) {
      const at = kickoffMs(match);
      if (!Number.isFinite(at)) continue;
      const clashes = group.some((other) => {
        if (other === match) return false;
        const otherAt = kickoffMs(other);
        return Number.isFinite(otherAt) && Math.abs(otherAt - at) < OVERLAP_MINUTES * 60000;
      });
      if (clashes && match.channelBinding !== "resolved") {
        match.channelBinding = "contested";
      }
    }
  }
  return rows;
}

function channelFieldsFrom(row) {
  if (!row) return {};
  const out = {};
  if (row.channel) out.channel = row.channel;
  if (row.channelId) out.channelId = row.channelId;
  if (row.channelBinding) out.channelBinding = row.channelBinding;
  if (row.broadcast) out.broadcast = row.broadcast;
  if (row.commentators && row.commentators.length) out.commentators = row.commentators;
  return out;
}

function hasRealChannel(row) {
  if (row?.broadcast?.channelId) return true;
  return !!(row && row.channelId && row.channelId !== "bein-sports-1");
}

/** Keep the broadcast channel that was assigned while the match was live. */
function pinEndedChannels(matches, previousPayload) {
  if (!previousPayload) return;
  const prevMatches = previousPayload.matches || [];
  const prevIndex = new Map((previousPayload.commentaryIndex || []).map((c) => [c.key, c]));
  const prevByKey = new Map(prevMatches.map((m) => [pairKey(m.home, m.away), m]));

  for (const m of matches) {
    if (m.status !== "ended") continue;
    const key = pairKey(m.home, m.away);
    const prevM = prevByKey.get(key);
    const prevC = prevIndex.get(key);
    const pin = hasRealChannel(prevM) ? prevM : hasRealChannel(prevC) ? prevC : null;
    if (!pin) continue;
    Object.assign(m, channelFieldsFrom(pin));
    if (pin.commentators && pin.commentators.length) {
      m.commentator = pin.commentators[0].name;
    }
  }
}

/** Merge fresh commentators with cache; never replace channel mapping for ended fixtures. */
function mergeCommentaryIndex(fresh, previous, matches) {
  const endedKeys = new Set(
    matches.filter((m) => m.status === "ended").map((m) => pairKey(m.home, m.away)),
  );
  const prevByKey = new Map((previous || []).map((c) => [c.key, c]));
  const out = [];
  const seen = new Set();

  for (const row of fresh || []) {
    if (!row || !row.key) continue;
    if (endedKeys.has(row.key)) {
      const prev = prevByKey.get(row.key);
      if (hasRealChannel(prev)) {
        out.push({ ...row, ...channelFieldsFrom(prev), locked: true });
        seen.add(row.key);
        continue;
      }
      if (hasRealChannel(row)) {
        out.push({ ...row, locked: true });
        seen.add(row.key);
        continue;
      }
    }
    out.push(row.locked ? row : { ...row, locked: false });
    seen.add(row.key);
  }

  for (const row of previous || []) {
    if (!row || !row.key || seen.has(row.key)) continue;
    out.push({ ...row, locked: row.locked || endedKeys.has(row.key) });
    seen.add(row.key);
  }

  for (const m of matches) {
    if (m.status !== "ended" || !hasRealChannel(m)) continue;
    const key = pairKey(m.home, m.away);
    if (seen.has(key)) continue;
    out.push({
      key,
      home: m.home,
      away: m.away,
      commentators: m.commentators || [],
      channel: m.channel,
      ...(m.channelId ? { channelId: m.channelId } : {}),
      ...(m.broadcast ? { broadcast: m.broadcast } : {}),
      locked: true,
    });
    seen.add(key);
  }

  return out;
}

module.exports = {
  normalizeArabic,
  normalizeEnglish,
  arabicTeamToEnglish,
  pairKey,
  prettyChannel,
  parseCommentators,
  buildIndex,
  attachCommentators,
  markContestedBindings,
  ensureSaudiBroadcastFallback,
  pinEndedChannels,
  mergeCommentaryIndex,
};
