/* ============================================================================
 * data.js — Channels & match schedule data
 * ----------------------------------------------------------------------------
 * This is the single source of truth for the site's content. Edit the arrays
 * below to add/remove channels or matches. Each channel's `stream` field is a
 * demo HLS (.m3u8) feed; replace it with your own LICENSED stream URL to go
 * live. No copyrighted broadcasts are bundled with this project.
 * ==========================================================================*/

// The site streams a single real live source. Player 1 uses this channel's
// embed; Player 2 (VIP) on the watch page is a second source kept for now while
// comparing which stream is smoothest.
const CHANNELS = [
  { id: "bein-sports-1", name: "beIN Sports", group: "beIN", quality: "1080p", badge: "HD",
    embed: { url: "https://vip.worldkoora.com/albaplayer/vip1/", param: "serv", servers: 3 } },
];

// Fallback only — shown if both the live API and cached today.json fail to load.
const MATCHES = [];

// Expose for non-module scripts.
window.SITE_DATA = { CHANNELS, MATCHES };

/* ---------------------------------------------------------------------------
 * getMatches(): returns REAL fixtures from assets/data/today.json (refreshed by
 * the GitHub Action / scripts/fetch-matches.js). Falls back to the sample
 * MATCHES above only if the live file can't be loaded (e.g. opened via file://).
 * ------------------------------------------------------------------------- */
// Corrects cached snapshot status using kickoff timestamp when API status is stale.
const MATCH_WINDOW_MS = 135 * 60 * 1000;
const RECENT_ENDED_MS = 18 * 60 * 60 * 1000;
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
  return new Intl.DateTimeFormat("ar", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(kickoff));
}

window.getMatchTimeZones = function getMatchTimeZones(m) {
  return [
    {
      key: "ksa",
      label: "بتوقيت السعودية",
      shortLabel: "السعودية",
      value: formatMatchTime(m, "Asia/Riyadh"),
    },
    {
      key: "et",
      label: "بتوقيت شرق أمريكا (ET)",
      shortLabel: "شرق أمريكا",
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
    (data.commentaryIndex || []).forEach((c) => { idx[c.key] = c.commentators; });
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
    if (m.commentators && m.commentators.length) return m;
    const list = idx[commentaryKey(m.home, m.away)];
    if (!list || !list.length) return m;
    return { ...m, commentators: list, commentator: m.commentator || list[0].name };
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
    return { matches: MATCHES, updatedAt: null, date: null, live: false, source: "demo", sourceLabel: "بيانات تجريبية" };
  }
};
