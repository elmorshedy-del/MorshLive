/* ============================================================================
 * data.js — Channels & match schedule data
 * ----------------------------------------------------------------------------
 * This is the single source of truth for the site's content. Edit the arrays
 * below to add/remove channels or matches. Each channel's `stream` field is a
 * demo HLS (.m3u8) feed; replace it with your own LICENSED stream URL to go
 * live. No copyrighted broadcasts are bundled with this project.
 * ==========================================================================*/

// Public, royalty-free demo HLS streams used as placeholders.
const DEMO_STREAMS = {
  bbb: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  tears: "https://test-streams.mux.dev/pts_shift/master.m3u8",
  apple: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8",
};

const CHANNELS = [
  // Embed channel — reproduces the known-good commit 9878075 exactly.
  { id: "bein-sports-1",       name: "beIN Sports 1",        group: "beIN",     quality: "1080p", stream: DEMO_STREAMS.bbb,   badge: "HD",
    embed: { url: "https://vip.worldkoora.com/albaplayer/vip1/", param: "serv", servers: 3 } },
  { id: "bein-sports-2",       name: "beIN Sports 2",        group: "beIN",     quality: "1080p", stream: DEMO_STREAMS.tears, badge: "HD" },
  { id: "bein-sports-3",       name: "beIN Sports 3",        group: "beIN",     quality: "1080p", stream: DEMO_STREAMS.apple, badge: "HD" },
  { id: "bein-sports-4",       name: "beIN Sports 4",        group: "beIN",     quality: "720p",  stream: DEMO_STREAMS.bbb },
  { id: "bein-sports-5",       name: "beIN Sports 5",        group: "beIN",     quality: "720p",  stream: DEMO_STREAMS.tears },
  { id: "bein-sports-6",       name: "beIN Sports 6",        group: "beIN",     quality: "720p",  stream: DEMO_STREAMS.apple },
  { id: "bein-premium-1",      name: "beIN Premium 1",       group: "Premium",  quality: "1080p", stream: DEMO_STREAMS.bbb,   badge: "4K" },
  { id: "bein-premium-2",      name: "beIN Premium 2",       group: "Premium",  quality: "1080p", stream: DEMO_STREAMS.tears, badge: "4K" },
  { id: "ssc-1",               name: "SSC 1",                group: "SSC",      quality: "1080p", stream: DEMO_STREAMS.apple, badge: "HD" },
  { id: "ssc-2",               name: "SSC 2",                group: "SSC",      quality: "1080p", stream: DEMO_STREAMS.bbb },
  { id: "ad-sports-1",         name: "AD Sports 1",          group: "AD",       quality: "1080p", stream: DEMO_STREAMS.tears },
  { id: "dubai-sports-1",      name: "Dubai Sports 1",       group: "Dubai",    quality: "720p",  stream: DEMO_STREAMS.apple },
];

// FALLBACK sample matches — only shown if assets/data/today.json can't be
// loaded (e.g. opened via file://). Real fixtures come from getMatches() below,
// refreshed by scripts/fetch-matches.js + the GitHub Action.
// status: "live" | "upcoming" | "ended"
const MATCHES = [
  {
    id: "m1", status: "live", minute: "67'",
    home: "ريال مدريد", away: "برشلونة",
    homeAbbr: "RMA", awayAbbr: "BAR",
    score: "2 - 1", time: "21:00",
    league: "الدوري الإسباني", channel: "beIN Sports 1",
    channelId: "bein-sports-1", commentator: "عصام الشوالي",
  },
  {
    id: "m2", status: "live", minute: "33'",
    home: "ليفربول", away: "مانشستر سيتي",
    homeAbbr: "LIV", awayAbbr: "MCI",
    score: "0 - 0", time: "21:30",
    league: "الدوري الإنجليزي", channel: "beIN Sports 2",
    channelId: "bein-sports-2", commentator: "حفيظ دراجي",
  },
  {
    id: "m3", status: "upcoming",
    home: "بايرن ميونخ", away: "دورتموند",
    homeAbbr: "BAY", awayAbbr: "DOR",
    score: "VS", time: "22:45",
    league: "الدوري الألماني", channel: "beIN Sports 3",
    channelId: "bein-sports-3", commentator: "رؤوف خليف",
  },
  {
    id: "m4", status: "upcoming",
    home: "يوفنتوس", away: "إنتر ميلان",
    homeAbbr: "JUV", awayAbbr: "INT",
    score: "VS", time: "23:00",
    league: "الدوري الإيطالي", channel: "beIN Premium 1",
    channelId: "bein-premium-1", commentator: "علي محمد علي",
  },
  {
    id: "m5", status: "upcoming",
    home: "الهلال", away: "النصر",
    homeAbbr: "HIL", awayAbbr: "NAS",
    score: "VS", time: "20:00",
    league: "الدوري السعودي", channel: "SSC 1",
    channelId: "ssc-1", commentator: "فهد العتيبي",
  },
  {
    id: "m6", status: "ended",
    home: "باريس سان جيرمان", away: "مارسيليا",
    homeAbbr: "PSG", awayAbbr: "MAR",
    score: "3 - 0", time: "أمس",
    league: "الدوري الفرنسي", channel: "beIN Sports 4",
    channelId: "bein-sports-4", commentator: "جواد بده",
  },
];

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

window.getMatches = async function getMatches({ force } = {}) {
  // 1) Live fetch from TheSportsDB in the browser (best — real statuses, auto-refresh)
  if (window.MatchesAPI) {
    try {
      const live = await window.MatchesAPI.fetchLiveSoccer({ force });
      if (live.matches && live.matches.length) return live;
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
