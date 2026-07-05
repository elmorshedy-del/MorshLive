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
};

function embedUrlFor(embed, extra) {
  if (!embed || !embed.url) return "";
  const base = typeof location !== "undefined" ? location.origin : "https://korazero.com";
  const u = new URL(embed.url, base);
  if (embed.channelId) u.searchParams.set("ch", embed.channelId);
  const opts = extra && typeof extra === "object" ? extra : {};
  if (opts.matchId) u.searchParams.set("match", opts.matchId);
  if (opts.mode && opts.mode !== "dual") u.searchParams.set("mode", opts.mode);
  if (opts.serv != null && opts.serv !== "") u.searchParams.set("serv", String(opts.serv));
  u.searchParams.set("_kz", "10"); // bust stale iframe cache when player UI changes
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
    u.searchParams.set("_kz", "10");
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
    const res = await fetch("assets/data/today.json", { cache: "no-store" });
    const data = await res.json();
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
        competition: entry.competition,
        thumbnail: entry.thumbnail,
        source: entry.source,
      },
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

const STAT_DEFS = [
  { key: "possessionPct", labelAr: "الاستحواذ", percent: true },
  { key: "totalShots", labelAr: "التسديدات" },
  { key: "shotsOnTarget", labelAr: "تسديدات على المرمى" },
  { key: "wonCorners", labelAr: "الركلات الركنية" },
  { key: "foulsCommitted", labelAr: "الأخطاء" },
  { key: "offsides", labelAr: "التسلل" },
  { key: "yellowCards", labelAr: "البطاقات الصفراء" },
  { key: "redCards", labelAr: "البطاقات الحمراء" },
  { key: "totalPasses", labelAr: "التمريرات" },
  { key: "passPct", labelAr: "دقة التمرير", percent: true },
  { key: "totalTackles", labelAr: "التدخلات" },
  { key: "interceptions", labelAr: "الاعتراضات" },
  { key: "totalClearance", labelAr: "الإبعادات" },
  { key: "totalCrosses", labelAr: "العرضيات" },
  { key: "saves", labelAr: "التصديات" },
];

const BAND_ORDER = ["gk", "def", "mid", "fwd"];
function bandLabel(b) {
  return window.I18N ? window.I18N.t("band." + b) : b;
}

function statRowHtml(def, home, away) {
  const h = home[def.key];
  const a = away[def.key];
  if (h == null && a == null) return "";
  const hv = h || 0;
  const av = a || 0;
  // Always render as each side's share of the combined total, never the raw
  // value as a width — a "percent" stat like pass accuracy is independent per
  // team (can be 80% + 80%), so using the raw number as a bar width would
  // overflow the row. The exact value still shows via the number label.
  const total = hv + av;
  const hPct = total ? (hv / total) * 100 : 0;
  const aPct = total ? (av / total) * 100 : 0;
  const fmt = (v) => (def.percent ? `${Math.round(v)}%` : Math.round(v));
  return `
    <div class="stat-row">
      <div class="stat-values">
        <span class="stat-value stat-value-home">${fmt(hv)}</span>
        <span class="stat-label">${def.labelAr}</span>
        <span class="stat-value stat-value-away">${fmt(av)}</span>
      </div>
      <div class="stat-bar">
        <div class="stat-bar-home" style="width:${hPct}%"></div>
        <div class="stat-bar-away" style="width:${aPct}%"></div>
      </div>
    </div>`;
}

function buildStatsHtml(m) {
  if (!m || !m.stats) return "";
  const homeAr = window.TeamNames ? window.TeamNames.arabicFor(m.home) || m.home : m.home;
  const awayAr = window.TeamNames ? window.TeamNames.arabicFor(m.away) || m.away : m.away;
  const rows = STAT_DEFS.map((def) => statRowHtml(def, m.stats.home, m.stats.away)).join("");
  if (!rows) return "";
  return `
    <div class="match-stats">
      <div class="stat-legend">
        <span class="stat-legend-item stat-legend-home"><i class="stat-dot"></i>${dataEscapeHtml(homeAr)}</span>
        <span class="stat-legend-item stat-legend-away"><i class="stat-dot"></i>${dataEscapeHtml(awayAr)}</span>
      </div>
      ${rows}
    </div>`;
}

function lineupPlayerHtml(p) {
  return `<li><span class="lineup-jersey">${dataEscapeHtml(p.jersey)}</span><span class="lineup-name">${dataEscapeHtml(p.name)}</span></li>`;
}

function lineupTeamHtml(team, teamNameAr) {
  const byBand = { gk: [], def: [], mid: [], fwd: [] };
  team.starters.forEach((p) => { (byBand[p.band] || byBand.mid).push(p); });
  const bands = BAND_ORDER.filter((b) => byBand[b].length).map((b) => `
    <div class="lineup-band">
      <b>${bandLabel(b)}</b>
      <ul>${byBand[b].map(lineupPlayerHtml).join("")}</ul>
    </div>`).join("");
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
      ${bands}
      ${subs}
    </div>`;
}

function buildLineupsHtml(m) {
  if (!m || !m.lineups) return "";
  const homeAr = window.TeamNames ? window.TeamNames.arabicFor(m.home) || m.home : m.home;
  const awayAr = window.TeamNames ? window.TeamNames.arabicFor(m.away) || m.away : m.away;
  return `
    <div class="match-lineups">
      ${lineupTeamHtml(m.lineups.home, homeAr)}
      ${lineupTeamHtml(m.lineups.away, awayAr)}
    </div>`;
}

let _matchDetailIdx = null;
let _matchDetailAt = 0;
async function loadMatchDetailIndex() {
  if (_matchDetailIdx && Date.now() - _matchDetailAt < 5 * 60 * 1000) return _matchDetailIdx;
  try {
    const res = await fetch("assets/data/today.json", { cache: "no-store" });
    const data = await res.json();
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
    if (m.lineups && m.stats) return m;
    const entry = idx[commentaryKey(m.home, m.away)];
    if (!entry) return m;
    const out = { ...m };
    if (!out.lineups && entry.lineups) out.lineups = entry.lineups;
    if (!out.stats && entry.stats) out.stats = entry.stats;
    return out;
  });
}

window.buildStatsHtml = buildStatsHtml;
window.buildLineupsHtml = buildLineupsHtml;

window.getMatches = async function getMatches({ force } = {}) {
  // 1) Live fetch from TheSportsDB in the browser (best — real statuses, auto-refresh)
  if (window.MatchesAPI) {
    try {
      const live = await window.MatchesAPI.fetchLiveSoccer({ force });
      if (live.matches && live.matches.length) {
        const idx = await loadCommentaryIndex();
        const hidx = await loadHighlightsIndex();
        const didx = await loadMatchDetailIndex();
        const withCommentary = applyCommentary(live.matches, idx);
        const withHighlights = applyHighlights(withCommentary, hidx);
        return { ...live, matches: applyMatchDetail(withHighlights, didx) };
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
