/* ============================================================================
 * data.js — Channels & match schedule data
 * ----------------------------------------------------------------------------
 * This is the single source of truth for the site's content. Edit the arrays
 * below to add/remove channels or matches. Each channel's `stream` field is a
 * demo HLS (.m3u8) feed; replace it with your own LICENSED stream URL to go
 * live. No copyrighted broadcasts are bundled with this project.
 * ==========================================================================*/

// ---------------------------------------------------------------------------
// Per-channel streaming source (CANONICAL binding).
// ---------------------------------------------------------------------------
// Every beIN channel resolves to a STABLE dlhd (daddylive) 24/7 endpoint through
// the worker's /dl/<id> proxy. These ids are FIXED — beIN Sports 1 is always
// dlhd 91 — so a match's channel maps to the exact same feed every game, with
// zero per-match calibration. This replaces the old worldkoora vip1/vip2 model,
// where 2 generic slots were hand-guessed onto N channels every kickoff (the
// root cause of "recode every game" + simultaneous-match collisions).
//
// The worker follows dlhd's domain rotations and signs/proxies the stream, so no
// CDN host is ever hardcoded here. To retarget a channel, change only its number.
// Verified live. (dlhd beIN Sports 1–9 Arabic = 91–99; MENA English 1/2 = 61/90.)
const DLHD_CHANNEL = {
  "bein-sports-1": 91, // beIN Sports 1 (Arabic)
  "bein-sports-2": 92, // beIN Sports 2 (Arabic)
  "bein-max-1": 94,    // beIN Sports 4 (Arabic)
  "bein-max-2": 95,    // beIN Sports 5 (Arabic)
  "bein-max-3": 96,    // beIN Sports 6 (Arabic)
  "bein-max-4": 97,    // beIN Sports 7 (Arabic)
};
const DEFAULT_CHANNEL_ID = "bein-sports-1";

// An "embed" is now just a per-channel player URL. Kept as an object (with a
// stable `key` == channelId, and `servers: 1` since dlhd has one feed per
// channel) so existing callers in watch.js / watch-embed.js keep working.
function normalizedChannelId(channelId) {
  return DLHD_CHANNEL[channelId] != null ? channelId : DEFAULT_CHANNEL_ID;
}
function embedKeyFor(channelId) {
  return normalizedChannelId(channelId);
}
function embedFor(channelId) {
  const id = normalizedChannelId(channelId);
  return { url: "/dl/" + DLHD_CHANNEL[id], channelId: id, key: id, servers: 1 };
}
// key == channelId in the new model, so keying by channel or by "key" is the same.
function embedForKey(key) {
  return embedFor(key);
}

function embedUrlFor(embed, serverIndex) {
  if (!embed || !embed.url) return "";
  const base = typeof location !== "undefined" ? location.origin : "https://korazero.com";
  // /dl/<id> is a complete self-contained player; no serv/ch query needed.
  return new URL(embed.url, base).toString();
}

// Retained for signature compatibility — dlhd channels have a single feed.
function servIndexFromParam() {
  return 0;
}

// Legacy no-op: the worldkoora calibration doc is retired (binding is now
// deterministic). Kept defined so any lingering reference stays harmless.
const EMBED_BINDING = {};

// Real beIN channels the schedule can reference. Each channel keeps its true
// name (shown in the UI) and resolves to its stable dlhd feed above, so a match
// always maps to the same real channel every game — no parity guess, no
// per-kickoff recalibration. beIN Sports 1 stays first as the default fallback.
const CHANNEL_DEFS = [
  { id: "bein-sports-1", name: "beIN Sports 1", group: "beIN", quality: "1080p", badge: "HD" },
  { id: "bein-sports-2", name: "beIN Sports 2", group: "beIN", quality: "1080p", badge: "HD" },
  { id: "bein-max-1", name: "beIN MAX 1", group: "beIN", quality: "1080p", badge: "HD" },
  { id: "bein-max-2", name: "beIN MAX 2", group: "beIN", quality: "1080p", badge: "HD" },
  { id: "bein-max-3", name: "beIN MAX 3", group: "beIN", quality: "1080p", badge: "HD" },
  { id: "bein-max-4", name: "beIN MAX 4", group: "beIN", quality: "1080p", badge: "HD" },
];
const CHANNELS = CHANNEL_DEFS.map((c) => ({ ...c, embed: { ...embedFor(c.id), channelId: c.id } }));

// Fallback only — shown if both the live API and cached today.json fail to load.
const MATCHES = [];

// Pick channel + match for the watch page. When a match id is in the URL, its
// channelId always wins — fixes showing Germany while another match is selected.
function resolveWatchSelection(matches, channels, searchParams) {
  const params = searchParams || new URLSearchParams(location.search);
  const liveMatch = matches.find((m) => m.status === "live");
  const reqCh = params.get("ch");
  const matchId = params.get("match");
  const explicitMatch = matchId ? matches.find((m) => m.id === matchId) : null;

  let chId;
  if (explicitMatch && explicitMatch.channelId) {
    chId = explicitMatch.channelId;
  } else if ((!reqCh || reqCh === "live") && liveMatch && liveMatch.channelId) {
    chId = liveMatch.channelId;
  } else if (reqCh && reqCh !== "live") {
    chId = reqCh;
  } else {
    chId = (channels[0] && channels[0].id) || "bein-sports-1";
  }

  const match = explicitMatch || ((!reqCh || reqCh === "live") && liveMatch ? liveMatch : null);
  const channel = channels.find((c) => c.id === chId) || channels[0];
  // Channel drives the source now (deterministic). Any stale per-match embedKey
  // (a leftover vip1/vip2 tag from the old model) is ignored.
  const embedKey = embedKeyFor(chId);
  const channelWithEmbed = { ...channel, embed: { ...embedForKey(embedKey), channelId: chId } };
  return { channel: channelWithEmbed, match, embedKey };
}

// Expose for non-module scripts.
window.SITE_DATA = { CHANNELS, MATCHES, embedKeyFor, embedForKey, embedUrlFor, servIndexFromParam, EMBED_BINDING, DLHD_CHANNEL };
window.resolveWatchSelection = resolveWatchSelection;
window.isRecentlyEndedMatch = isRecentlyEndedMatch;
window.keepDisplayMatch = keepDisplayMatch;

/* ---------------------------------------------------------------------------
 * getMatches(): returns REAL fixtures from assets/data/today.json (refreshed by
 * the GitHub Action / scripts/fetch-matches.js). Falls back to the sample
 * MATCHES above only if the live file can't be loaded (e.g. opened via file://).
 * ------------------------------------------------------------------------- */
// Corrects cached snapshot status using kickoff timestamp when API status is stale.
const MATCH_WINDOW_MS = 135 * 60 * 1000;
const RECENT_ENDED_MS = 18 * 60 * 60 * 1000;
const POST_MATCH_STREAM_MS = 2 * 60 * 60 * 1000;
function parseKickoffMs(ts) {
  if (!ts) return NaN;
  const text = String(ts).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)
    ? `${text}Z`
    : text;
  return Date.parse(normalized);
}

function refineStatus(m, dateStr) {
  if (m.status === "ended") return "ended";
  const kickoff = m.kickoffUtc
    ? parseKickoffMs(m.kickoffUtc)
    : (dateStr && m.time && /^\d{2}:\d{2}$/.test(m.time) ? Date.parse(`${dateStr}T${m.time}:00Z`) : NaN);
  if (isNaN(kickoff)) return m.status;
  const elapsed = Date.now() - kickoff;
  if (elapsed < 0) return "upcoming";
  if (elapsed < MATCH_WINDOW_MS) return m.status === "ended" ? "ended" : "live";
  return "ended";
}

function keepDisplayMatch(m) {
  if (m.status !== "ended") return true;
  const kickoff = parseKickoffMs(m.kickoffUtc);
  if (isNaN(kickoff)) return true;
  return Date.now() - kickoff <= MATCH_WINDOW_MS + RECENT_ENDED_MS;
}

/** Ended within the post-match stream window — "just finished" + commentary still available. */
function isRecentlyEndedMatch(m) {
  if (!m || m.status !== "ended") return false;
  const kickoff = parseKickoffMs(m.kickoffUtc);
  if (isNaN(kickoff)) return false;
  const elapsed = Date.now() - kickoff;
  if (elapsed < 0) return false;
  return elapsed <= MATCH_WINDOW_MS + POST_MATCH_STREAM_MS;
}

function sortDisplayMatches(matches) {
  const order = { live: 0, upcoming: 1, ended: 2 };
  return matches.sort((a, b) => {
    const byStatus = order[a.status] - order[b.status];
    if (byStatus) return byStatus;
    const at = parseKickoffMs(a.kickoffUtc);
    const bt = parseKickoffMs(b.kickoffUtc);
    if (!isNaN(at) && !isNaN(bt)) {
      return a.status === "ended" ? bt - at : at - bt;
    }
    return (a.time || "").localeCompare(b.time || "");
  });
}

function formatMatchTime(m, timeZone) {
  const kickoff = m && m.kickoffUtc ? parseKickoffMs(m.kickoffUtc) : NaN;
  if (isNaN(kickoff)) return null;
  const locale = (window.I18N && window.I18N.lang === "en") ? "en" : "ar";
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(kickoff));
}

window.getMatchTimeZones = function getMatchTimeZones(m) {
  const tr = (k) => (window.I18N ? window.I18N.t(k) : k);
  return [
    {
      key: "ksa",
      label: tr("tz.ksa"),
      shortLabel: tr("tz.ksaShort"),
      value: formatMatchTime(m, "Asia/Riyadh"),
    },
    {
      key: "et",
      label: tr("tz.et"),
      shortLabel: tr("tz.etShort"),
      value: formatMatchTime(m, "America/New_York"),
    },
  ].filter((item) => item.value);
};

/* Commentators (المعلّق) — joined from the cached commentaryIndex so that live
   API results (which lack commentator data) still show them. */
function commentaryKey(home, away) {
  const norm = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return [norm(home), norm(away)].sort().join("~");
}

let _commentaryIdx = null;
let _commentaryAt = 0;
async function loadCommentaryIndex() {
  if (_commentaryIdx && Date.now() - _commentaryAt < 5 * 60 * 1000) return _commentaryIdx;
  try {
    const res = await fetch("assets/data/today.json", { cache: "no-store" });
    const data = await res.json();
    const idx = {};
    (data.commentaryIndex || []).forEach((c) => { idx[c.key] = c; });
    _commentaryIdx = idx;
    _commentaryAt = Date.now();
  } catch (e) {
    _commentaryIdx = _commentaryIdx || {};
  }
  return _commentaryIdx;
}

function applyCommentary(matches, idx) {
  if (!idx) return matches;
  return matches.map((m) => {
    const entry = idx[commentaryKey(m.home, m.away)];
    if (!entry) return m;
    const out = { ...m };
    const ended = m.status === "ended";

    if (entry.commentators && entry.commentators.length) {
      out.commentators = entry.commentators;
      out.commentator = out.commentator || entry.commentators[0].name;
    }

    if (!ended) {
      if (entry.channel) out.channel = entry.channel;
      if (entry.channelId) out.channelId = entry.channelId;
      return out;
    }

    // Ended fixtures keep their pinned broadcast channel (set in today.json).
    if (entry.locked) {
      if (entry.channel) out.channel = entry.channel;
      if (entry.channelId) out.channelId = entry.channelId;
    }
    return out;
  });
}

window.getMatches = async function getMatches({ force } = {}) {
  // 1) Live fetch from TheSportsDB in the browser (best — real statuses, auto-refresh)
  if (window.MatchesAPI) {
    try {
      const live = await window.MatchesAPI.fetchLiveSoccer({ force });
      if (live.matches && live.matches.length) {
        const idx = await loadCommentaryIndex();
        return { ...live, matches: applyCommentary(live.matches, idx) };
      }
    } catch (e) {
      console.warn("Live API fetch failed, using cache:", e.message);
    }
  }

  // 2) Cached JSON (GitHub Action / offline fallback)
  try {
    const res = await fetch("assets/data/today.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const raw = Array.isArray(data.matches) ? data.matches : [];
    const matches = sortDisplayMatches(
      raw.map((m) => ({ ...m, status: refineStatus(m, data.date) })).filter(keepDisplayMatch)
    );
    return {
      matches,
      updatedAt: data.updatedAt,
      date: data.date,
      live: true,
      source: data.source || "thesportsdb",
      sourceLabel: data.sourceLabel || "TheSportsDB (cache)",
    };
  } catch (e) {
    // 3) Demo sample data
    return { matches: MATCHES, updatedAt: null, date: null, live: false, source: "demo", sourceLabel: (window.I18N ? window.I18N.t("updated.demo") : "بيانات تجريبية") };
  }
};
