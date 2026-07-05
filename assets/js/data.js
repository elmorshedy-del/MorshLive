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
};

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
  if (serv != null && serv !== "") u.searchParams.set("serv", String(serv));
  u.searchParams.set("_kz", "8");
  return u.toString();
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
window.SITE_DATA = { CHANNELS, MATCHES, EMBEDS, embedKeyFor, embedForKey, embedUrlFor, servIndexFromParam, EMBED_BINDING };
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

/* Bars start at width:0 with the real value stashed in data-w, then
   window.activateStatBars() flips them to their target width on the next
   frame so the fill animates in instead of appearing pre-filled. */
function statBarHtml(hPct, aPct) {
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
  // Always render as each side's share of the combined total, never the raw
  // value as a width — a "percent" stat like pass accuracy is independent per
  // team (can be 80% + 80%), so using the raw number as a bar width would
  // overflow the row. The exact value still shows via the number label.
  const total = hv + av;
  const hPct = total ? (hv / total) * 100 : 0;
  const aPct = total ? (av / total) * 100 : 0;
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
      ${statBarHtml(hPct, aPct)}
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
  const total = hv + av;
  const hPct = total ? (hv / total) * 100 : 50;
  const aPct = total ? (av / total) * 100 : 50;
  return `
    <div class="stat-hero">
      <div class="stat-hero-label">الاستحواذ</div>
      <div class="stat-hero-values">
        <span class="stat-hero-value stat-hero-value--home">${Math.round(hv)}%</span>
        <span class="stat-hero-value stat-hero-value--away">${Math.round(av)}%</span>
      </div>
      ${statBarHtml(hPct, aPct)}
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

/* Green pitch: bands laid out left (attack) to right (goalkeeper), each
   player's row position spread evenly within its band. A player currently
   on loses no minutes here — a substitute swapped in keeps the tactical
   band of whoever they replaced (see match-detail-lib.js), so the pitch
   always reflects who is actually out there right now, cards and all. */
const PITCH_BAND_X = { fwd: 13, mid: 40, def: 66, gk: 90 };

function pitchRowY(count, i) {
  if (count <= 1) return 50;
  const pad = 14;
  return pad + i * ((100 - pad * 2) / (count - 1));
}

function pitchDotHtml(p, x, y, isAway) {
  const cardBadge = p.redCards > 0
    ? '<span class="pitch-card pitch-card--red" title="بطاقة حمراء"></span>'
    : p.yellowCards > 0
      ? '<span class="pitch-card pitch-card--yellow" title="بطاقة صفراء"></span>'
      : "";
  const subTitle = p.subFor
    ? `بديل عن ${p.subFor}${p.subMinute ? ` (${p.subMinute})` : ""}`
    : "";
  const subBadge = p.subFor ? `<span class="pitch-sub-badge" title="${dataEscapeHtml(subTitle)}">⇄</span>` : "";
  return `
    <div class="pitch-dot${isAway ? " pitch-dot--away" : ""}" style="left:${x}%;top:${y}%">
      <span class="pitch-jersey">${dataEscapeHtml(p.jersey)}${cardBadge}${subBadge}</span>
      <span class="pitch-name">${dataEscapeHtml(p.name)}</span>
    </div>`;
}

function pitchHtml(team, isAway) {
  const byBand = { gk: [], def: [], mid: [], fwd: [] };
  team.starters.forEach((p) => { (byBand[p.band] || byBand.mid).push(p); });
  const dots = BAND_ORDER.map((b) => {
    const list = byBand[b];
    const x = PITCH_BAND_X[b];
    return list.map((p, i) => pitchDotHtml(p, x, pitchRowY(list.length, i), isAway)).join("");
  }).join("");
  return `
    <div class="match-pitch">
      <div class="pitch-box pitch-box--gk"></div>
      <div class="pitch-box pitch-box--goal"></div>
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

let _matchDetailIdx = null;
let _matchDetailAt = 0;
async function loadMatchDetailIndex() {
  if (_matchDetailIdx && Date.now() - _matchDetailAt < 60 * 1000) return _matchDetailIdx;
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
    const entry = idx[commentaryKey(m.home, m.away)];
    if (!entry) return m;
    const out = { ...m };
    if (entry.lineups) out.lineups = entry.lineups;
    if (entry.stats) out.stats = entry.stats;
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
window.activateStatBars = activateStatBars;

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
        const withStaticDetail = applyMatchDetail(withHighlights, didx);
        const withLiveDetail = await enrichLiveMatchDetails(withStaticDetail, { force });
        return { ...live, matches: withLiveDetail };
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
    const didx = await loadMatchDetailIndex();
    const raw = Array.isArray(data.matches) ? data.matches : [];
    const matches = sortDisplayMatches(
      applyMatchDetail(
        raw.map((m) => ({ ...m, status: refineStatus(m, data.date) })).filter(keepDisplayMatch),
        didx
      )
    );
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
