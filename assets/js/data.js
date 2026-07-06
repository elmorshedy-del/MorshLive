/* ============================================================================
 * data.js — Channels & match schedule data
 * ----------------------------------------------------------------------------
 * This is the single source of truth for the site's content. Edit the arrays
 * below to add/remove channels or matches. Each channel's `stream` field is a
 * demo HLS (.m3u8) feed; replace it with your own LICENSED stream URL to go
 * live. No copyrighted broadcasts are bundled with this project.
 * ==========================================================================*/

// ---------------------------------------------------------------------------
// Playable embeds (worldkoora). Only these two exist — every other player slug
// (vip3, bein-max-1, …) returns 404. Each is a GENERIC feed that is NOT tied to
// a fixed beIN channel; which match it carries is decided upstream. The `serv`
// query param is cosmetic (all values return the same stream), so each embed
// has exactly one real server.
// ---------------------------------------------------------------------------
// Worldkoora labels its upstream buttons as "البث 1" -> serv=1, "البث 2" ->
// serv=2, and so on. Expose several choices because upstream rotates which
// ones contain direct HLS, nested iframes, or blank/preroll-only loaders.
// Same-origin /wk/ proxy (worker.js) serves worldkoora vip pages without preroll ads.
const EMBEDS = {
  vip1: { url: "/wk/albaplayer/vip1/" },
  vip2: { url: "/wk/albaplayer/vip2/" },
  weshan: {
    url: "/wk/albaplayer/weshan/",
    servStart: 0,
    defaultServer: 0,
    servers: 4,
  },
  amine: {
    url: "/wk/albaplayer/amine/",
    servStart: 0,
    defaultServer: 0,
    servers: 4,
  },
  // Alternative backup players — proxied ad-free on /wk/albaplayer/{sirtv,ntv}/.
  sirtv: { url: "/wk/albaplayer/sirtv/", defaultServer: 1, servers: 1 },
  ntv: { url: "/wk/albaplayer/ntv/", defaultServer: 1, servers: 1 },
};

// Pinned matches that show the separate backup panel (Sir TV + NTV).
const ALT_STREAM_MATCHES = {
  "espn-fifa.world-760506": { sirTv: true, ntv: true },
  "portugal~spain": { sirTv: true, ntv: true },
};

const ALT_STREAM_DEFS = {
  sirTv: { key: "sirTv", path: "/wk/albaplayer/sirtv/", labelKey: "watch.altSirTv" },
  ntv: { key: "ntv", path: "/wk/albaplayer/ntv/", labelKey: "watch.altNtv" },
};

function altStreamsForMatch(m) {
  if (!m) return null;
  const pin = ALT_STREAM_MATCHES[m.id] || ALT_STREAM_MATCHES[matchStreamKey(m)] || null;
  if (!pin) return null;
  const out = {};
  if (pin.sirTv) out.sirTv = ALT_STREAM_DEFS.sirTv;
  if (pin.ntv) out.ntv = ALT_STREAM_DEFS.ntv;
  return Object.keys(out).length ? out : null;
}

function altStreamUrl(kind) {
  const def = ALT_STREAM_DEFS[kind];
  if (!def) return "";
  const base = typeof location !== "undefined" ? location.origin : "https://korazero.com";
  const u = new URL(def.path, base);
  u.searchParams.set("_kz", "13");
  return u.toString();
}

function matchStreamKey(m) {
  if (!m) return "";
  if (m.key) return String(m.key).toLowerCase();
  if (m.home && m.away) {
    return `${String(m.home).toLowerCase()}~${String(m.away).toLowerCase()}`;
  }
  return "";
}

function embedUrlFor(embed, serv) {
  if (!embed || !embed.url) return "";
  if (embed.external) {
    const u = new URL(embed.url);
    const s = serv != null && serv !== "" ? serv : (embed.defaultServer != null ? embed.defaultServer : 0);
    u.searchParams.set("serv", String(s));
    return u.toString();
  }
  const base = typeof location !== "undefined" ? location.origin : "https://korazero.com";
  const u = new URL(embed.url, base);
  if (embed.channelId) u.searchParams.set("ch", embed.channelId);
  let servNum = serv;
  let matchId = null;
  if (serv && typeof serv === "object") {
    servNum = serv.serv != null ? serv.serv : (serv.mode ? embed.defaultServer : serv);
    matchId = serv.matchId || null;
  }
  if (servNum != null && servNum !== "") u.searchParams.set("serv", String(servNum));
  if (matchId) u.searchParams.set("match", matchId);
  u.searchParams.set("_kz", "9");
  return u.toString();
}

// dlhd 24/7 ids for the watch-page source picker (mirrors worker.js DLHD_CHANNEL_MIRROR_IDS).
const DLHD_STREAM_IDS = {
  "bein-sports-1": { backup: 91, labelKey: "watch.optDlhdSports1" },
  "bein-sports-2": { backup: 92, labelKey: "watch.optDlhdSports2" },
  "bein-max-1": { maxAr: 597, sportsAr: 91 },
  "bein-max-2": { maxAr: 597, sportsAr: 92 },
  "bein-max-3": { maxAr: 597, sportsAr: 94 },
  "bein-max-4": { maxAr: 597, sportsAr: 95 },
};

function streamOptionUrl(opt, channelId, matchId) {
  const base = typeof location !== "undefined" ? location.origin : "https://korazero.com";
  if (opt.path) {
    const u = new URL(opt.path, base);
    u.searchParams.set("ch", channelId);
    if (matchId) u.searchParams.set("match", matchId);
    u.searchParams.set("_kz", "12");
    return u.toString();
  }
  const embed = { ...embedForKey(opt.embedKey), channelId };
  return embedUrlFor(embed, { mode: opt.mode || "dual", matchId });
}

// Labeled stream sources for the watch page — honest about MAX vs Sports Arabic fallbacks.
function streamOptionsFor(channelId, match, embedKey) {
  const primaryKey = embedKey || embedKeyFor(channelId);
  const altKey = primaryKey === "vip1" ? "vip2" : "vip1";
  const isMax = /^bein-max-/.test(channelId || "");
  const dlhd = DLHD_STREAM_IDS[channelId] || null;

  const opts = [
    {
      id: "auto",
      labelKey: "watch.optAuto",
      hintKey: "watch.optAutoHint",
      embedKey: primaryKey,
      mode: "dual",
      kind: "reachable",
      recommended: true,
    },
    {
      id: `vip-${altKey}`,
      labelKey: "watch.optAltVip",
      hintKey: "watch.optAltVipHint",
      labelVars: { slot: altKey.toUpperCase() },
      embedKey: altKey,
      mode: "dual",
      kind: "reachable",
    },
    {
      id: "hls",
      labelKey: "watch.optHls",
      hintKey: "watch.optHlsHint",
      embedKey: primaryKey,
      mode: "hls",
      kind: "reachable",
    },
    {
      id: "twitch",
      labelKey: "watch.optTwitch",
      hintKey: "watch.optTwitchHint",
      embedKey: primaryKey,
      mode: "twitch",
      kind: "reachable",
    },
  ];

  if (isMax && dlhd) {
    if (dlhd.maxAr) {
      opts.push({
        id: "dlhd-max",
        labelKey: "watch.optMaxAr",
        hintKey: "watch.optMaxArHint",
        path: `/dl/${dlhd.maxAr}/`,
        kind: "reachable",
        fallback: true,
      });
    }
    if (dlhd.sportsAr) {
      opts.push({
        id: "dlhd-sports",
        labelKey: "watch.optSportsAr",
        hintKey: "watch.optSportsArHint",
        path: `/dl/${dlhd.sportsAr}/`,
        kind: "reachable",
        fallback: true,
        sportsOnly: true,
      });
    }
  } else if (dlhd && dlhd.backup) {
    opts.push({
      id: "dlhd-backup",
      labelKey: dlhd.labelKey || "watch.optDlhdBackup",
      hintKey: "watch.optDlhdBackupHint",
      path: `/dl/${dlhd.backup}/`,
      kind: "reachable",
      fallback: true,
    });
  }

  return opts.map((o) => ({
    ...o,
    url: streamOptionUrl(o, channelId, match && match.id),
  }));
}

function servIndexFromParam(embed, raw) {
  const start = embed && embed.servStart != null ? embed.servStart : 0;
  const fallback = embed && embed.defaultServer != null ? embed.defaultServer : 0;
  const serv = Number(raw);
  const max = embed && embed.servers ? embed.servers - 1 : Infinity;
  if (raw == null || raw === "" || Number.isNaN(serv)) return Math.min(fallback, max);
  return Math.max(0, Math.min(max, serv - start));
}

// Embed routing — loaded from channel-bindings.js (synced from channel-bindings.json).
const BINDING_DOC = window.KZ_CHANNEL_BINDINGS || {
  embedBinding: {
    "bein-max-1": "vip1",
    "bein-max-2": "vip2",
    "bein-max-3": "vip2",
    "bein-max-4": "vip1",
    "bein-sports-1": "vip1",
    "bein-sports-2": "vip1",
  },
};
const EMBED_BINDING = BINDING_DOC.embedBinding;
const DEFAULT_EMBED = "vip1";

function embedKeyFor(channelId) {
  return EMBED_BINDING[channelId] || DEFAULT_EMBED;
}

function embedFor(channelId) {
  const key = embedKeyFor(channelId);
  return EMBEDS[key] || EMBEDS[DEFAULT_EMBED];
}

function embedForKey(key) {
  return EMBEDS[key] || EMBEDS[DEFAULT_EMBED];
}

// Real beIN channels the schedule can reference. Each channel keeps its true
// name (shown in the UI) and resolves its playable embed through the calibration
// above, so a single match always maps to its actual channel — not a parity guess.
// beIN Sports 1 stays first so it remains the default fallback channel.
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
  const embedKey = (match && match.embedKey) || embedKeyFor(chId);
  const channelWithEmbed = { ...channel, embed: { ...embedForKey(embedKey), channelId: chId } };
  return { channel: channelWithEmbed, match, embedKey };
}

// Expose for non-module scripts.
window.SITE_DATA = {
  CHANNELS, MATCHES, EMBEDS, embedKeyFor, embedForKey, embedUrlFor,
  servIndexFromParam, EMBED_BINDING, streamOptionsFor, streamOptionUrl,
  altStreamsForMatch, altStreamUrl,
};
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
let _todayData = null;
let _todayAt = 0;

async function loadTodayData() {
  if (_todayData && Date.now() - _todayAt < 5 * 60 * 1000) return _todayData;
  try {
    const res = await fetch("assets/data/today.json", { cache: "default" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    _todayData = await res.json();
    _todayAt = Date.now();
  } catch (e) {
    _todayData = _todayData || { commentaryIndex: [], highlightsIndex: [], matchDetailIndex: [], matches: [] };
  }
  return _todayData;
}

async function loadCommentaryIndex() {
  if (_commentaryIdx && Date.now() - _commentaryAt < 5 * 60 * 1000) return _commentaryIdx;
  try {
    const data = await loadTodayData();
    const idx = {};
    (data.commentaryIndex || []).forEach((c) => { idx[c.key] = c; });
    _commentaryIdx = idx;
    _commentaryAt = Date.now();
  } catch (e) {
    _commentaryIdx = _commentaryIdx || {};
  }
  return _commentaryIdx;
}

function applyTodayChannelIds(matches, todayMatches) {
  if (!Array.isArray(todayMatches) || !todayMatches.length) return matches;
  const byId = new Map(
    todayMatches.filter((m) => m.id && m.channelId).map((m) => [m.id, m])
  );
  return matches.map((m) => {
    const src = byId.get(m.id);
    if (!src || !src.channelId) return m;
    const out = { ...m, channelId: src.channelId };
    if (src.channel) out.channel = src.channel;
    return out;
  });
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

/* ملخص المباراة (Arabic match summary) + highlight clip — mirrors
   scripts/highlights-lib.js so ended fixtures get a recap even when served
   from the live API (which has no summaryAr/highlight field of its own). */
function parseScoreParts(score) {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec((score || "").trim());
  return m ? { home: parseInt(m[1], 10), away: parseInt(m[2], 10) } : null;
}

function buildArabicSummary(m) {
  const teamLabel = (n) => (window.TeamNames ? window.TeamNames.arabicFor(n) || n : n);
  const homeAr = teamLabel(m.home);
  const awayAr = teamLabel(m.away);
  const league = m.league || "المباراة";
  const venue = m.venue ? ` على ملعب ${m.venue}` : "";
  const parts = parseScoreParts(m.score);

  let text;
  if (!parts) {
    text = `انتهت مباراة ${homeAr} و${awayAr} ضمن ${league}${venue}.`;
  } else if (parts.home === parts.away) {
    text = `انتهت المباراة بالتعادل بين ${homeAr} و${awayAr} بنتيجة ${parts.home}-${parts.away} ضمن ${league}${venue}.`;
  } else {
    const homeWon = parts.home > parts.away;
    const winnerAr = homeWon ? homeAr : awayAr;
    const loserAr = homeWon ? awayAr : homeAr;
    const winnerScore = Math.max(parts.home, parts.away);
    const loserScore = Math.min(parts.home, parts.away);
    text = `انتهت المباراة بفوز ${winnerAr} على ${loserAr} بنتيجة ${winnerScore}-${loserScore} ضمن ${league}${venue}.`;
  }
  if (m.commentator) text += ` تعليق: ${m.commentator}.`;
  return text;
}

let _highlightsIdx = null;
let _highlightsAt = 0;
async function loadHighlightsIndex() {
  if (_highlightsIdx && Date.now() - _highlightsAt < 5 * 60 * 1000) return _highlightsIdx;
  try {
    const data = await loadTodayData();
    const idx = {};
    (data.highlightsIndex || []).forEach((h) => { idx[h.key] = h; });
    _highlightsIdx = idx;
    _highlightsAt = Date.now();
  } catch (e) {
    _highlightsIdx = _highlightsIdx || {};
  }
  return _highlightsIdx;
}

function applyHighlights(matches, idx) {
  return matches.map((m) => {
    if (m.status !== "ended") return m;
    const out = m.summaryAr ? m : { ...m, summaryAr: buildArabicSummary(m) };
    if (out.highlight) return out;
    const entry = idx && idx[commentaryKey(m.home, m.away)];
    if (!entry) return out;
    return {
      ...out,
      highlight: {
        videoUrl: entry.videoUrl,
        title: entry.title,
        channelTitle: entry.channelTitle,
        thumbnail: entry.thumbnail,
        source: entry.source,
      },
    };
  });
}

const _highlightFetchCache = new Map();

async function fetchHighlightFromApi(m) {
  const key = commentaryKey(m.home, m.away);
  if (_highlightFetchCache.has(key)) return _highlightFetchCache.get(key);
  const promise = (async () => {
    try {
      const params = new URLSearchParams({ home: m.home, away: m.away });
      if (m.kickoffUtc) params.set("kickoff", m.kickoffUtc);
      const res = await fetch(`/api/highlight?${params.toString()}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.videoUrl ? data : null;
    } catch {
      return null;
    }
  })();
  _highlightFetchCache.set(key, promise);
  return promise;
}

/** Fill missing replay clips for ended matches via /api/highlight (YouTube, server-side). */
async function ensureHighlightsFromApi(matches) {
  const pending = matches.filter((m) => m.status === "ended" && !m.highlight);
  if (!pending.length) return matches;
  const results = await Promise.all(
    pending.map(async (m) => {
      const h = await fetchHighlightFromApi(m);
      return h ? { key: commentaryKey(m.home, m.away), highlight: h } : null;
    })
  );
  const byKey = new Map(results.filter(Boolean).map((r) => [r.key, r.highlight]));
  if (!byKey.size) return matches;
  return matches.map((m) => {
    const h = byKey.get(commentaryKey(m.home, m.away));
    if (!h) return m;
    return {
      ...m,
      summaryAr: m.summaryAr || buildArabicSummary(m),
      highlight: h,
    };
  });
}

/* التشكيلة + الإحصائيات المتقدمة (lineups + advanced stats) — mirrors
   scripts/match-detail-lib.js. Sourced from ESPN's free site API, so only
   matches with an "espn-..." id carry this; everything else renders "". */
function dataEscapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* possessionPct is rendered separately as the hero stat; the rest are grouped
   into categories so the panel reads as designed sections, not a flat list.
   "لا يوجد أفضلية معلنة" note: discipline stats (fouls/cards/offsides) never
   get a winner highlight — "leading" in cards isn't a thing to celebrate. */
const STAT_GROUPS = [
  {
    key: "attack", labelAr: "الهجوم", icon: "target",
    stats: [
      { key: "totalShots", labelAr: "التسديدات" },
      { key: "shotsOnTarget", labelAr: "تسديدات على المرمى" },
      { key: "wonCorners", labelAr: "الركلات الركنية" },
      { key: "totalCrosses", labelAr: "العرضيات" },
    ],
  },
  {
    key: "passing", labelAr: "التمرير", icon: "pass",
    stats: [
      { key: "totalPasses", labelAr: "التمريرات" },
      { key: "passPct", labelAr: "دقة التمرير", percent: true },
    ],
  },
  {
    key: "defense", labelAr: "الدفاع", icon: "shield",
    stats: [
      { key: "totalTackles", labelAr: "التدخلات" },
      { key: "interceptions", labelAr: "الاعتراضات" },
      { key: "totalClearance", labelAr: "الإبعادات" },
      { key: "saves", labelAr: "التصديات" },
    ],
  },
  {
    key: "discipline", labelAr: "الانضباط", icon: "card", noLead: true,
    stats: [
      { key: "foulsCommitted", labelAr: "الأخطاء" },
      { key: "offsides", labelAr: "التسلل" },
      { key: "yellowCards", labelAr: "البطاقات الصفراء" },
      { key: "redCards", labelAr: "البطاقات الحمراء" },
    ],
  },
];

const GROUP_ICON = {
  target: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5" fill="currentColor"/></svg>',
  pass: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17h11m0 0-4-4m4 4-4 4"/><path d="M20 7H9m0 0 4-4M9 7l4 4"/></svg>',
  shield: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5Z"/></svg>',
  card: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="10" height="15" rx="1.5" transform="rotate(10 10 10.5)"/></svg>',
};

const BAND_ORDER = ["gk", "def", "mid", "fwd"];
function bandLabel(b) {
  return window.I18N ? window.I18N.t("band." + b) : b;
}

/* Each side's share of the combined total — never the raw value as a width
   (a percent stat like pass accuracy is independent per team and can be
   80% + 80%). A trailing side with a real value keeps a visible sliver so it
   never disappears; 0–0 leaves the neutral track empty. */
function barShares(hv, av) {
  const total = hv + av;
  if (total <= 0) return { hPct: 0, aPct: 0, empty: true };
  let hPct = (hv / total) * 100;
  let aPct = 100 - hPct;
  const FLOOR = 6;
  if (hv > 0 && hPct < FLOOR) { hPct = FLOOR; aPct = 100 - FLOOR; }
  else if (av > 0 && aPct < FLOOR) { aPct = FLOOR; hPct = 100 - FLOOR; }
  return { hPct, aPct, empty: false };
}

/* Bars start at width:0 with the real value stashed in data-w, then
   window.activateStatBars() flips them to their target width on the next
   frame so the fill animates in instead of appearing pre-filled. */
function statBarHtml(hv, av) {
  const { hPct, aPct } = barShares(hv, av);
  return `
    <div class="stat-bar">
      <div class="stat-bar-home" data-w="${hPct}" style="width:0%"></div>
      <div class="stat-bar-away" data-w="${aPct}" style="width:0%"></div>
    </div>`;
}

function statRowHtml(def, home, away, noLead) {
  const h = home[def.key];
  const a = away[def.key];
  if (h == null && a == null) return "";
  const hv = h || 0;
  const av = a || 0;
  const fmt = (v) => (def.percent ? `${Math.round(v)}%` : Math.round(v));
  const homeLead = !noLead && hv > av;
  const awayLead = !noLead && av > hv;
  return `
    <div class="stat-row">
      <div class="stat-values">
        <span class="stat-value stat-value-home${homeLead ? " stat-value--lead" : ""}">${fmt(hv)}</span>
        <span class="stat-label">${def.labelAr}</span>
        <span class="stat-value stat-value-away${awayLead ? " stat-value--lead" : ""}">${fmt(av)}</span>
      </div>
      ${statBarHtml(hv, av)}
    </div>`;
}

function statGroupHtml(group, home, away) {
  const rows = group.stats.map((def) => statRowHtml(def, home, away, group.noLead)).join("");
  if (!rows.trim()) return "";
  return `
    <div class="stat-group">
      <div class="stat-group-head">${GROUP_ICON[group.icon] || ""}<span>${group.labelAr}</span></div>
      ${rows}
    </div>`;
}

function statHeroHtml(m) {
  const h = m.stats.home.possessionPct;
  const a = m.stats.away.possessionPct;
  if (h == null && a == null) return "";
  const hv = h || 0;
  const av = a || 0;
  // Possession is a share by definition — normalise so the two shown figures
  // always add to 100 (ESPN's raw 44.5/55.5 would otherwise round to 45/56).
  const total = hv + av;
  const homePct = total ? Math.round((hv / total) * 100) : 50;
  const awayPct = 100 - homePct;
  return `
    <div class="stat-hero">
      <div class="stat-hero-label">الاستحواذ</div>
      <div class="stat-hero-values">
        <span class="stat-hero-value stat-hero-value--home">${homePct}%</span>
        <span class="stat-hero-value stat-hero-value--away">${awayPct}%</span>
      </div>
      ${statBarHtml(homePct, awayPct)}
    </div>`;
}

/* Runs after buildStatsHtml() is inserted into the DOM — flips each bar
   segment from width:0 to its real share so the fill animates on reveal. */
function activateStatBars(root) {
  if (!root || !root.querySelectorAll) return;
  const bars = root.querySelectorAll(".stat-bar-home[data-w], .stat-bar-away[data-w]");
  if (!bars.length) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bars.forEach((el) => { el.style.width = `${el.dataset.w}%`; });
    });
  });
}

function buildStatsHtml(m) {
  if (!m || !m.stats) return "";
  const homeAr = window.TeamNames ? window.TeamNames.arabicFor(m.home) || m.home : m.home;
  const awayAr = window.TeamNames ? window.TeamNames.arabicFor(m.away) || m.away : m.away;
  const hero = statHeroHtml(m);
  const groups = STAT_GROUPS.map((g) => statGroupHtml(g, m.stats.home, m.stats.away)).join("");
  if (!hero && !groups.trim()) return "";
  return `
    <div class="match-stats">
      <div class="stat-legend">
        <span class="stat-legend-item stat-legend-home">${crestOrDot(m.homeBadge, m.homeAbbr, "home")}${dataEscapeHtml(homeAr)}</span>
        <span class="stat-legend-item stat-legend-away">${dataEscapeHtml(awayAr)}${crestOrDot(m.awayBadge, m.awayAbbr, "away")}</span>
      </div>
      ${hero}
      ${groups}
    </div>`;
}

function crestOrDot(badge, abbr, side) {
  if (badge) return `<img class="stat-legend-crest" src="${badge}" alt="" loading="lazy">`;
  return `<i class="stat-dot stat-dot--${side}"></i>`;
}

function lineupPlayerHtml(p) {
  return `<li><span class="lineup-jersey">${dataEscapeHtml(p.jersey)}</span><span class="lineup-name">${dataEscapeHtml(p.name)}</span></li>`;
}

/* Green pitch, laid out by the REAL formation (e.g. 4-2-3-1) rather than
   collapsing everyone into 4 bands: the formation string gives the exact
   number of players per line, so the pitch is proportional and never crams
   5 players into one "midfield" column. A substitute keeps the pitch slot
   of whoever they replaced (see match-detail-lib.js), so the layout always
   reflects who is actually on the field right now. */

/* Depth score (defensive → attacking) from ESPN's position abbreviation,
   used only to ORDER outfielders back-to-front; the formation counts decide
   how that ordering is sliced into lines. ESPN abbreviations look like
   "CD-L" / "AM-R" / "DM" / "LB", so match the base token (before any "-")
   against exact sets — a prefix regex would misfile "DM"/"CDM" as defenders. */
const POS_DEPTH = (() => {
  const map = {};
  const add = (list, v) => list.forEach((k) => { map[k] = v; });
  add(["CD", "CB", "SW", "D", "LB", "RB", "WB", "LWB", "RWB", "RCB", "LCB"], 10);
  add(["DM", "CDM", "DEF MID"], 20);
  add(["CM", "M", "LM", "RM", "LCM", "RCM", "MID"], 30);
  add(["AM", "CAM", "ATT MID"], 40);
  add(["F", "CF", "ST", "S", "FW", "W", "LW", "RW", "LF", "RF"], 50);
  return map;
})();

function posDepth(p) {
  const a = (p.pos || "").toUpperCase().split("-")[0].trim();
  if (a === "G" || p.band === "gk") return 0;
  if (a in POS_DEPTH) return POS_DEPTH[a];
  if (p.band === "def") return 10;
  if (p.band === "fwd") return 50;
  return 30;
}

/* Left→right weight within a line (maps to the pitch's vertical axis, since
   the pitch is rotated 90°): left-flank first, centre, right-flank. */
function posSide(p) {
  const a = (p.pos || "").toUpperCase();
  if (/L/.test(a)) return -1;
  if (/R/.test(a)) return 1;
  return 0;
}

/* Returns [{ p, x, y }] for every starter. Falls back to even bands when the
   formation string is missing or its counts don't match the XI. */
function pitchPositions(team) {
  const starters = team.starters || [];
  const gks = starters.filter((p) => p.band === "gk" || (p.pos || "").toUpperCase() === "G");
  const outfield = starters.filter((p) => !gks.includes(p));
  const rowSizes = String(team.formation || "").split(/[^0-9]+/).map(Number).filter((n) => n > 0);
  const sumOut = rowSizes.reduce((a, b) => a + b, 0);

  const usable = gks.length === 1 && rowSizes.length >= 2 && sumOut === outfield.length;
  if (!usable) return pitchPositionsByBand(starters);

  // Lines from goal line (GK) outward to attack.
  const sorted = outfield.slice().sort((a, b) => posDepth(a) - posDepth(b)
    || (a.formationPlace || 99) - (b.formationPlace || 99));
  const lines = [gks];
  let idx = 0;
  for (const size of rowSizes) {
    lines.push(sorted.slice(idx, idx + size));
    idx += size;
  }

  // x: GK on the right (near its goal), attack on the left. y: spread within a line.
  const N = lines.length;
  const xRight = 92, xLeft = 9;
  const out = [];
  lines.forEach((line, r) => {
    const x = N <= 1 ? xRight : xRight - r * ((xRight - xLeft) / (N - 1));
    const ordered = line.slice().sort((a, b) => posSide(a) - posSide(b)
      || (a.formationPlace || 99) - (b.formationPlace || 99));
    const count = ordered.length;
    ordered.forEach((p, i) => {
      const y = count <= 1 ? 50 : 15 + i * (70 / (count - 1));
      out.push({ p, x, y });
    });
  });
  return out;
}

function pitchPositionsByBand(starters) {
  const bandX = { fwd: 13, mid: 40, def: 66, gk: 90 };
  const byBand = { gk: [], def: [], mid: [], fwd: [] };
  starters.forEach((p) => { (byBand[p.band] || byBand.mid).push(p); });
  const out = [];
  ["gk", "def", "mid", "fwd"].forEach((b) => {
    const list = byBand[b];
    const count = list.length;
    list.forEach((p, i) => {
      const y = count <= 1 ? 50 : 15 + i * (70 / (count - 1));
      out.push({ p, x: bandX[b], y });
    });
  });
  return out;
}

function pitchCardHtml(p) {
  // Second yellow shows as a red; a straight red also shows red. A lone yellow
  // shows yellow. Rendered as a small tilted card, not a bare rectangle.
  if (p.redCards > 0 && p.yellowCards > 0) {
    return '<span class="pitch-card pitch-card--second" title="إنذار ثانٍ ← طرد"></span>';
  }
  if (p.redCards > 0) return '<span class="pitch-card pitch-card--red" title="بطاقة حمراء"></span>';
  if (p.yellowCards > 0) return '<span class="pitch-card pitch-card--yellow" title="بطاقة صفراء"></span>';
  return "";
}

function pitchDotHtml(p, x, y, isAway) {
  const subTitle = p.subFor
    ? `بديل عن ${p.subFor}${p.subMinute ? ` (${p.subMinute})` : ""}`
    : "";
  const subBadge = p.subFor ? `<span class="pitch-sub-badge" title="${dataEscapeHtml(subTitle)}">↑</span>` : "";
  return `
    <div class="pitch-dot${isAway ? " pitch-dot--away" : ""}" style="left:${x}%;top:${y}%">
      <span class="pitch-jersey">${dataEscapeHtml(p.jersey)}</span>
      ${pitchCardHtml(p)}${subBadge}
      <span class="pitch-name">${dataEscapeHtml(p.name)}</span>
    </div>`;
}

function pitchHtml(team, isAway) {
  const dots = pitchPositions(team)
    .map(({ p, x, y }) => pitchDotHtml(p, x, y, isAway))
    .join("");
  return `
    <div class="match-pitch">
      <div class="pitch-box pitch-box--gk"></div>
      <div class="pitch-box pitch-box--goal"></div>
      <div class="pitch-spot"></div>
      ${dots}
    </div>`;
}

function lineupTeamHtml(team, teamNameAr, isAway) {
  const subsLabel = window.I18N ? window.I18N.t("card.subs") : "الاحتياط";
  const subs = team.subs && team.subs.length
    ? `<details class="lineup-subs">
         <summary>${subsLabel} (${team.subs.length})</summary>
         <ul>${team.subs.map(lineupPlayerHtml).join("")}</ul>
       </details>`
    : "";
  return `
    <div class="lineup-team">
      <h4>${dataEscapeHtml(teamNameAr)}${team.formation ? ` <span class="lineup-formation">${dataEscapeHtml(team.formation)}</span>` : ""}</h4>
      ${pitchHtml(team, isAway)}
      ${subs}
    </div>`;
}

function buildLineupsHtml(m) {
  if (!m || !m.lineups) return "";
  const homeAr = window.TeamNames ? window.TeamNames.arabicFor(m.home) || m.home : m.home;
  const awayAr = window.TeamNames ? window.TeamNames.arabicFor(m.away) || m.away : m.away;
  return `
    <div class="match-lineups">
      ${lineupTeamHtml(m.lineups.home, homeAr, false)}
      ${lineupTeamHtml(m.lineups.away, awayAr, true)}
    </div>`;
}

/* Goal scorers + minutes (من سجّل ومتى) — a two-column strip, home on the
   right (RTL). Penalty and own-goal are tagged. Returns "" when no goals. */
const BALL_ICON = '<svg class="goal-ball" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#fff" stroke="rgba(0,0,0,.35)"/><path d="M12 6.5l3.2 2.3-1.2 3.8h-4l-1.2-3.8z" fill="#0e1424"/></svg>';

function goalItemHtml(g) {
  const tag = g.own ? ' <i class="goal-tag">ضد نفسه</i>' : g.penalty ? ' <i class="goal-tag">ركلة جزاء</i>' : "";
  return `<li>${BALL_ICON}<span class="goal-scorer">${dataEscapeHtml(g.scorer)}</span><span class="goal-min">${dataEscapeHtml(g.minute)}</span>${tag}</li>`;
}

function buildGoalsHtml(m) {
  const goals = m && m.goals;
  if (!Array.isArray(goals) || !goals.length) return "";
  const home = goals.filter((g) => g.side === "home").map(goalItemHtml).join("");
  const away = goals.filter((g) => g.side === "away").map(goalItemHtml).join("");
  if (!home && !away) return "";
  return `
    <div class="match-goals">
      <ul class="goal-col goal-col--home">${home}</ul>
      <span class="goal-sep">${BALL_ICON}</span>
      <ul class="goal-col goal-col--away">${away}</ul>
    </div>`;
}

let _matchDetailIdx = null;
let _matchDetailAt = 0;
async function loadMatchDetailIndex() {
  if (_matchDetailIdx && Date.now() - _matchDetailAt < 60 * 1000) return _matchDetailIdx;
  try {
    const data = await loadTodayData();
    const idx = {};
    (data.matchDetailIndex || []).forEach((d) => { idx[d.key] = d; });
    _matchDetailIdx = idx;
    _matchDetailAt = Date.now();
  } catch (e) {
    _matchDetailIdx = _matchDetailIdx || {};
  }
  return _matchDetailIdx;
}

function applyMatchDetail(matches, idx) {
  if (!idx) return matches;
  return matches.map((m) => {
    const entry = idx[commentaryKey(m.home, m.away)];
    if (!entry) return m;
    const out = { ...m };
    if (entry.lineups) out.lineups = entry.lineups;
    if (entry.stats) out.stats = entry.stats;
    if (entry.goals) out.goals = entry.goals;
    return out;
  });
}

async function enrichLiveMatchDetails(matches, { force } = {}) {
  if (!window.MatchDetailAPI || !window.MatchDetailAPI.enrichMatches) return matches;
  try {
    return await window.MatchDetailAPI.enrichMatches(matches, { force });
  } catch (e) {
    console.warn("Live match detail fetch failed:", e.message);
    return matches;
  }
}

window.buildStatsHtml = buildStatsHtml;
window.buildLineupsHtml = buildLineupsHtml;
window.buildGoalsHtml = buildGoalsHtml;
window.activateStatBars = activateStatBars;

function scheduleHighlightEnrich(matches) {
  const needsApi = matches.some((m) => m.status === "ended" && !m.highlight);
  if (!needsApi) return;
  ensureHighlightsFromApi(matches).then((enriched) => {
    if (typeof window.__kzOnMatchesUpdated === "function") window.__kzOnMatchesUpdated(enriched);
  }).catch(() => {});
}

window.getMatches = async function getMatches({ force } = {}) {
  // 1) Live fetch from TheSportsDB in the browser (best — real statuses, auto-refresh)
  if (window.MatchesAPI) {
    try {
      const live = await window.MatchesAPI.fetchLiveSoccer({ force });
      if (live.matches && live.matches.length) {
        const data = await loadTodayData();
        const idx = {};
        (data.commentaryIndex || []).forEach((c) => { idx[c.key] = c; });
        const hidx = {};
        (data.highlightsIndex || []).forEach((h) => { hidx[h.key] = h; });
        const didx = {};
        (data.matchDetailIndex || []).forEach((d) => { didx[d.key] = d; });
        const withCommentary = applyCommentary(live.matches, idx);
        const withChannels = applyTodayChannelIds(withCommentary, data.matches);
        const withHighlights = applyHighlights(withChannels, hidx);
        const withStaticDetail = applyMatchDetail(withHighlights, didx);
        const withLiveDetail = await enrichLiveMatchDetails(withStaticDetail, { force });
        scheduleHighlightEnrich(withLiveDetail);
        return { ...live, matches: withLiveDetail };
      }
    } catch (e) {
      console.warn("Live API fetch failed, using cache:", e.message);
    }
  }

  // 2) Cached JSON (GitHub Action / offline fallback)
  try {
    const data = await loadTodayData();
    const didx = await loadMatchDetailIndex();
    const raw = Array.isArray(data.matches) ? data.matches : [];
    let matches = sortDisplayMatches(
      applyMatchDetail(
        raw.map((m) => ({ ...m, status: refineStatus(m, data.date) })).filter(keepDisplayMatch),
        didx
      )
    );
    if (window.MatchesAPI && window.MatchesAPI.supplementEspnLiveScores) {
      matches = await window.MatchesAPI.supplementEspnLiveScores(matches);
      matches = sortDisplayMatches(matches.filter(keepDisplayMatch));
    }
    scheduleHighlightEnrich(matches);
    const withLiveDetail = await enrichLiveMatchDetails(matches, { force });
    return {
      matches: withLiveDetail,
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
