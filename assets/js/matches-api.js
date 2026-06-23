/* ============================================================================
 * matches-api.js — Live football fixtures from TheSportsDB (free, CORS-open).
 * https://www.thesportsdb.com/free_sports_api
 * Fetches today + yesterday in the browser so statuses stay current.
 * ==========================================================================*/
(function (global) {
  const API_KEY = "3"; // free public test key — upgrade via SPORTSDB_KEY env in CI
  const BASE = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;
  const CACHE_MS = 60 * 1000; // 1 min client cache

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

  function statusOf(strStatus, strTimestamp) {
    const s = (strStatus || "").trim();
    if (!s || s === "NS" || /not started/i.test(s)) {
      return kickoffStatus(strTimestamp, "upcoming");
    }
    if (ENDED.has(s) || /^FT/i.test(s)) return "ended";
    if (LIVE.has(s) || /^\d+$/.test(s) || /'/.test(s) || /half/i.test(s)) return "live";
    return kickoffStatus(strTimestamp, "upcoming");
  }

  function kickoffStatus(ts, fallback) {
    if (!ts) return fallback;
    const kickoff = Date.parse(ts);
    if (isNaN(kickoff)) return fallback;
    const elapsed = Date.now() - kickoff;
    const windowMs = 135 * 60 * 1000;
    if (elapsed < 0) return "upcoming";
    if (elapsed < windowMs) return "live";
    return "ended";
  }

  function formatScore(hs, as, status) {
    const has = hs != null && hs !== "" && as != null && as !== "";
    if (has) return `${hs} - ${as}`;
    return status === "ended" ? "0 - 0" : "VS";
  }

  function formatTime(e) {
    if (e.strTimeLocal) return e.strTimeLocal.slice(0, 5);
    if (e.strTime) return e.strTime.slice(0, 5);
    if (e.strTimestamp) return new Date(e.strTimestamp).toISOString().slice(11, 16);
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
      channelId: "bein-sports-1",
      commentator: null,
      source: "thesportsdb",
    };
  }

  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function datesToFetch() {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return [isoDate(now), isoDate(yesterday)];
  }

  async function fetchDay(dateStr) {
    const url = `${BASE}/eventsday.php?d=${dateStr}&s=Soccer`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`TheSportsDB ${res.status} (${dateStr})`);
    const json = await res.json();
    return Array.isArray(json.events) ? json.events : [];
  }

  async function fetchLiveSoccer({ force } = {}) {
    if (!force && cache && Date.now() - cache.fetchedAt < CACHE_MS) {
      return cache.payload;
    }

    const dayLists = await Promise.all(datesToFetch().map(fetchDay));
    const seen = new Set();
    const matches = [];

    for (const events of dayLists) {
      for (const e of events) {
        const id = "e" + e.idEvent;
        if (seen.has(id)) continue;
        seen.add(id);
        matches.push(normalizeEvent(e));
      }
    }

    const order = { live: 0, upcoming: 1, ended: 2 };
    matches.sort(
      (a, b) => (order[a.status] - order[b.status]) || a.time.localeCompare(b.time)
    );

    const payload = {
      matches,
      updatedAt: new Date().toISOString(),
      date: isoDate(new Date()),
      live: true,
      source: "thesportsdb",
      sourceLabel: "TheSportsDB",
    };

    cache = { fetchedAt: Date.now(), payload };
    return payload;
  }

  global.MatchesAPI = { fetchLiveSoccer, normalizeEvent, datesToFetch };
})(window);
