/* ============================================================================
 * matches-api.js — Live football fixtures from TheSportsDB (free, CORS-open).
 * https://www.thesportsdb.com/free_sports_api
 * Fetches TheSportsDB plus ESPN's public scoreboard fallback in the browser so
 * statuses stay current even when one provider misses games.
 * ==========================================================================*/
(function (global) {
  const API_KEY = "3"; // free public test key — upgrade via SPORTSDB_KEY env in CI
  const BASE = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;
  const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
  // World Cup only for now.
  const ESPN_LEAGUES = ["fifa.world"];
  const WORLD_CUP_RE = /world\s*cup|كأس العالم/i;
  const CACHE_MS = 60 * 1000; // 1 min client cache
  const FETCH_TIMEOUT_MS = 5000;
  const MATCH_WINDOW_MS = 135 * 60 * 1000;
  const RECENT_ENDED_MS = 18 * 60 * 60 * 1000;

  const LIVE = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "IN PLAY", "INT"]);
  const ENDED = new Set(["FT", "AET", "PEN", "Match Finished", "AWD", "WO", "CANC", "ABD", "PST"]);

  let cache = null;

  function abbr(name) {
    return (name || "")
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase();
  }

  function parseKickoffMs(ts) {
    if (!ts) return NaN;
    const text = String(ts).trim();
    // TheSportsDB timestamps are UTC but are often returned without a timezone.
    const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)
      ? `${text}Z`
      : text;
    return Date.parse(normalized);
  }

  /** Infer upcoming/live from kickoff only when the provider has no status. Never infer "ended" from elapsed time — knockouts run ET and pens well past 90'. */
  function kickoffInferStatus(ts, fallback) {
    const kickoff = parseKickoffMs(ts);
    if (isNaN(kickoff)) return fallback;
    const elapsed = Date.now() - kickoff;
    if (elapsed < 0) return "upcoming";
    return "live";
  }

  function statusOf(strStatus, strTimestamp) {
    const s = (strStatus || "").trim();
    if (!s || s === "NS" || /not started/i.test(s)) {
      return kickoffInferStatus(strTimestamp, "upcoming");
    }
    if (ENDED.has(s) || /^FT/i.test(s)) return "ended";
    if (LIVE.has(s) || /^\d+$/.test(s) || /'/.test(s) || /half/i.test(s)) {
      return "live";
    }
    return kickoffInferStatus(strTimestamp, "upcoming");
  }

  function formatScore(hs, as, status) {
    if (status === "upcoming") return "VS";
    const has = hs != null && hs !== "" && as != null && as !== "";
    if (has) return `${hs} - ${as}`;
    return "—";
  }

  function formatTime(e) {
    if (e.strTimeLocal) return e.strTimeLocal.slice(0, 5);
    if (e.strTime) return e.strTime.slice(0, 5);
    if (e.strTimestamp) {
      const kickoff = parseKickoffMs(e.strTimestamp);
      if (!isNaN(kickoff)) return new Date(kickoff).toISOString().slice(11, 16);
    }
    return "—";
  }

  function normalizeEvent(e) {
    const status = statusOf(e.strStatus, e.strTimestamp);
    return {
      id: "e" + e.idEvent,
      status,
      minute: status === "live" ? (e.strProgress || e.strStatus || "مباشر") : "",
      home: e.strHomeTeam,
      away: e.strAwayTeam,
      homeAbbr: abbr(e.strHomeTeam),
      awayAbbr: abbr(e.strAwayTeam),
      homeBadge: e.strHomeTeamBadge || "",
      awayBadge: e.strAwayTeamBadge || "",
      score: formatScore(e.intHomeScore, e.intAwayScore, status),
      time: formatTime(e),
      kickoffUtc: e.strTimestamp || null,
      league: e.strLeague || "مباراة",
      venue: [e.strVenue, e.strCity].filter(Boolean).join(" · "),
      channel: null,
      channelId: null,
      commentator: null,
      source: "thesportsdb",
    };
  }

  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function shiftDate(iso, days) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return isoDate(d);
  }

  function datesToFetch() {
    const today = isoDate(new Date());
    return [shiftDate(today, -1), today, shiftDate(today, 1)];
  }

  function espnDateRange() {
    const today = isoDate(new Date());
    return `${shiftDate(today, -1).replace(/-/g, "")}-${shiftDate(today, 1).replace(/-/g, "")}`;
  }

  async function fetchJson(url, label) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`${label} ${res.status}`);
    return res.json();
  }

  async function fetchDay(dateStr) {
    const url = `${BASE}/eventsday.php?d=${dateStr}&s=Soccer`;
    const json = await fetchJson(url, `TheSportsDB (${dateStr})`);
    const events = Array.isArray(json.events) ? json.events : [];
    return events.filter((e) => WORLD_CUP_RE.test(e.strLeague || ""));
  }

  function espnStatus(status, kickoffUtc) {
    const type = status && status.type ? status.type : {};
    const state = (type.state || "").toLowerCase();
    if (type.completed || state === "post") return "ended";
    if (state === "in") return "live";
    return kickoffInferStatus(kickoffUtc, "upcoming");
  }

  function normalizeEspnEvent(e, league) {
    const competition = e.competitions && e.competitions[0] ? e.competitions[0] : {};
    const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
    const home = competitors.find((c) => c.homeAway === "home") || competitors[0] || {};
    const away = competitors.find((c) => c.homeAway === "away") || competitors[1] || {};
    const homeTeam = home.team || {};
    const awayTeam = away.team || {};
    const kickoffUtc = competition.date || e.date || null;
    const status = espnStatus(competition.status, kickoffUtc);
    const statusType = competition.status && competition.status.type ? competition.status.type : {};

    return {
      id: `espn-${(league && league.slug) || "soccer"}-${e.id}`,
      status,
      minute: status === "live" ? (competition.status && (competition.status.displayClock || statusType.shortDetail || statusType.detail)) || "مباشر" : "",
      home: homeTeam.displayName || homeTeam.name || e.name,
      away: awayTeam.displayName || awayTeam.name || "",
      homeAbbr: homeTeam.abbreviation || abbr(homeTeam.displayName || homeTeam.name),
      awayAbbr: awayTeam.abbreviation || abbr(awayTeam.displayName || awayTeam.name),
      homeBadge: homeTeam.logo || "",
      awayBadge: awayTeam.logo || "",
      score: formatScore(home.score, away.score, status),
      time: kickoffUtc ? new Date(parseKickoffMs(kickoffUtc)).toISOString().slice(11, 16) : "—",
      kickoffUtc,
      league: (league && league.name) || competition.altGameNote || "مباراة",
      venue: [
        competition.venue && competition.venue.fullName,
        competition.venue && competition.venue.address && competition.venue.address.city,
        competition.venue && competition.venue.address && competition.venue.address.country,
      ].filter(Boolean).join(" · "),
      channel: null,
      channelId: null,
      commentator: null,
      source: "espn",
    };
  }

  async function fetchEspnLeague(slug, dateRange) {
    const url = `${ESPN_BASE}/${slug}/scoreboard?dates=${dateRange}&limit=100`;
    const json = await fetchJson(url, `ESPN (${slug})`);
    const league = json.leagues && json.leagues[0] ? json.leagues[0] : { slug };
    const events = Array.isArray(json.events) ? json.events : [];
    return events.map((event) => normalizeEspnEvent(event, league));
  }

  function canonical(text) {
    return (text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  }

  function matchKey(m) {
    const kickoff = parseKickoffMs(m.kickoffUtc);
    const day = isNaN(kickoff) ? "" : new Date(kickoff).toISOString().slice(0, 10);
    return [day, canonical(m.home), canonical(m.away)].join("|");
  }

  function hasScore(m) {
    return !!(m && m.score && m.score !== "VS" && m.score !== "—");
  }

  function mergeMatch(existing, incoming) {
    const merged = { ...existing };
    if (incoming.status === "live") merged.status = "live";
    else if (incoming.status === "ended") merged.status = "ended";
    else if (existing.status === "upcoming") merged.status = incoming.status;
    if (incoming.minute) merged.minute = incoming.minute;
    if (hasScore(incoming)) merged.score = incoming.score;
    if (incoming.channel && !merged.channel) merged.channel = incoming.channel;
    if (incoming.channelId && !merged.channelId) merged.channelId = incoming.channelId;
    if (incoming.commentator && !merged.commentator) merged.commentator = incoming.commentator;
    if (incoming.venue && !merged.venue) merged.venue = incoming.venue;
    merged.source = existing.source === incoming.source ? existing.source : `${existing.source}+${incoming.source}`;
    return merged;
  }

  function mergeMatches(primary, fallback) {
    const byKey = new Map();
    const merged = [];
    for (const m of primary.concat(fallback)) {
      const key = matchKey(m);
      if (!key.replace(/\|/g, "")) {
        merged.push(m);
        continue;
      }
      const index = byKey.get(key);
      if (index == null) {
        byKey.set(key, merged.length);
        merged.push(m);
      } else {
        merged[index] = mergeMatch(merged[index], m);
      }
    }
    return merged;
  }

  function filterDisplayMatches(matches, now = Date.now()) {
    return matches.filter((m) => {
      if (m.status !== "ended") return true;
      const kickoff = parseKickoffMs(m.kickoffUtc);
      if (isNaN(kickoff)) return true;
      return now - kickoff <= MATCH_WINDOW_MS + RECENT_ENDED_MS;
    });
  }

  function sortMatches(matches) {
    const order = { live: 0, upcoming: 1, ended: 2 };
    return matches.sort((a, b) => {
      const byStatus = order[a.status] - order[b.status];
      if (byStatus) return byStatus;
      const at = parseKickoffMs(a.kickoffUtc);
      const bt = parseKickoffMs(b.kickoffUtc);
      if (!isNaN(at) && !isNaN(bt)) {
        return a.status === "ended" ? bt - at : at - bt;
      }
      return a.time.localeCompare(b.time);
    });
  }

  async function fetchLiveSoccer({ force } = {}) {
    if (!force && cache && Date.now() - cache.fetchedAt < CACHE_MS) {
      return cache.payload;
    }

    const [sportsDbSettled, espnSettled] = await Promise.all([
      Promise.allSettled(datesToFetch().map(fetchDay)),
      Promise.allSettled(ESPN_LEAGUES.map((slug) => fetchEspnLeague(slug, espnDateRange()))),
    ]);
    const seen = new Set();
    const sportsDbMatches = [];

    for (const result of sportsDbSettled) {
      if (result.status !== "fulfilled") continue;
      const events = result.value;
      for (const e of events) {
        const id = "e" + e.idEvent;
        if (seen.has(id)) continue;
        seen.add(id);
        sportsDbMatches.push(normalizeEvent(e));
      }
    }

    const espnMatches = espnSettled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const matches = filterDisplayMatches(mergeMatches(sportsDbMatches, espnMatches));
    sortMatches(matches);
    if (!matches.length) throw new Error("No live soccer fixtures found");
    const sourceLabel = sportsDbMatches.length && espnMatches.length
      ? "TheSportsDB + ESPN"
      : sportsDbMatches.length
        ? "TheSportsDB"
        : "ESPN";

    const payload = {
      matches,
      updatedAt: new Date().toISOString(),
      date: isoDate(new Date()),
      live: true,
      source: sportsDbMatches.length ? "thesportsdb" : "espn",
      sourceLabel,
    };

    cache = { fetchedAt: Date.now(), payload };
    return payload;
  }

  function pairKey(home, away) {
    return [canonical(home), canonical(away)].sort().join("~");
  }

  /** Merge live score/minute from ESPN when cached today.json is stale. */
  async function supplementEspnLiveScores(matches) {
    if (!Array.isArray(matches) || !matches.length) return matches;
    try {
      const espnResults = await Promise.allSettled(
        ESPN_LEAGUES.map((slug) => fetchEspnLeague(slug, espnDateRange()))
      );
      const espnMatches = espnResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      if (!espnMatches.length) return matches;
      const byKey = new Map(espnMatches.map((m) => [pairKey(m.home, m.away), m]));
      return matches.map((m) => {
        const hit = byKey.get(pairKey(m.home, m.away));
        if (!hit) return m;
        const out = { ...m };
        if (hit.status) out.status = hit.status;
        if (hit.score && hit.score !== "VS" && hit.score !== "—") out.score = hit.score;
        if (hit.minute) out.minute = hit.minute;
        if (hit.kickoffUtc) out.kickoffUtc = hit.kickoffUtc;
        return out;
      });
    } catch {
      return matches;
    }
  }

  global.MatchesAPI = {
    fetchLiveSoccer,
    supplementEspnLiveScores,
    normalizeEvent,
    normalizeEspnEvent,
    datesToFetch,
  };
})(window);
