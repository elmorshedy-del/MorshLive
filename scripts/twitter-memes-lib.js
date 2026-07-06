/* ============================================================================
 * twitter-memes-lib.js — post-match memes from three curated X accounts.
 *
 * Sources: @TrollFootball, @Contxtfootball, @memesvsfootball
 * (user typo "memesvsootball" → memesvsfootball)
 *
 * Flow:
 *  1. Resolve usernames → user IDs once (cached in twitter-user-ids.json)
 *  2. Pull tweets in a window ~25–55 min after estimated full time
 *  3. Keep captions that mention a team or player name
 *  4. Top 3 per account by engagement (likes + RTs + quotes)
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const https = require("https");

const TWITTER_API = "https://api.twitter.com/2";
const SYNDICATION = "https://syndication.twitter.com/srv/timeline-profile/screen-name";
const UA = "Mozilla/5.0 (compatible; MorshLive/1.0)";
const USER_IDS_PATH = path.join(__dirname, "..", "assets", "data", "twitter-user-ids.json");
const MEME_SOURCES_PATH = path.join(__dirname, "..", "assets", "data", "meme-sources.json");

function loadMemeSourcesConfig() {
  try {
    const json = JSON.parse(fs.readFileSync(MEME_SOURCES_PATH, "utf8"));
    const accounts = Array.isArray(json.accounts)
      ? json.accounts.filter((a) => a && a.key && a.username)
      : [];
    return {
      accounts,
      topPerAccount: Number(json.topPerAccount) || 3,
    };
  } catch {
    return { accounts: [], topPerAccount: 3 };
  }
}

function memeSources() {
  return loadMemeSourcesConfig().accounts;
}

function topPerAccount() {
  return loadMemeSourcesConfig().topPerAccount;
}

const MATCH_DURATION_MS = 105 * 60 * 1000;
const MEME_LOOKBACK_BEFORE_KICKOFF_MS = 15 * 60 * 1000;
const MEME_MATCH_CONTEXT_MS = 72 * 60 * 60 * 1000;

function normalizeBearer(token) {
  return token ? String(token).trim() : "";
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": UA } }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      })
      .on("error", reject);
  });
}

function twitterGet(urlPath, token) {
  return new Promise((resolve, reject) => {
    https
      .get(`${TWITTER_API}${urlPath}`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
      }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          let json;
          try { json = JSON.parse(d); } catch { json = null; }
          if (res.statusCode >= 400) {
            reject(new Error(`Twitter ${res.statusCode}: ${d.slice(0, 180)}`));
            return;
          }
          resolve(json);
        });
      })
      .on("error", reject);
  });
}

function loadCachedUserIds() {
  try {
    return JSON.parse(fs.readFileSync(USER_IDS_PATH, "utf8"));
  } catch {
    return { accounts: {} };
  }
}

function saveCachedUserIds(payload) {
  fs.writeFileSync(USER_IDS_PATH, JSON.stringify(payload, null, 2));
}

/** Resolve usernames → IDs once; refresh stale/missing entries. */
async function resolveMemeUserIds(bearerToken) {
  const token = normalizeBearer(bearerToken);
  const cached = loadCachedUserIds();
  const accounts = { ...(cached.accounts || {}) };
  let changed = false;

  for (const src of memeSources()) {
    const hit = accounts[src.key];
    if (hit && hit.id && hit.username) continue;
    if (src.id && src.username) {
      accounts[src.key] = { id: String(src.id), username: src.username };
      changed = true;
      continue;
    }
    if (!token) continue;
    try {
      const json = await twitterGet(
        `/users/by/username/${encodeURIComponent(src.username)}?user.fields=username`,
        token
      );
      if (json.data && json.data.id) {
        accounts[src.key] = {
          id: String(json.data.id),
          username: json.data.username || src.username,
        };
        changed = true;
      }
    } catch (err) {
      console.warn(`twitter user lookup failed for @${src.username}:`, err.message);
    }
  }

  if (changed) {
    saveCachedUserIds({ updatedAt: new Date().toISOString(), accounts });
  }
  return accounts;
}

function playerNamesFromMatch(match) {
  const names = [];
  const push = (n) => {
    const s = String(n || "").trim();
    if (s.length > 2 && !names.includes(s)) names.push(s);
  };
  for (const side of ["home", "away"]) {
    const lu = match.lineups && match.lineups[side];
    if (!lu) continue;
    for (const band of ["starters", "subs", "bench"]) {
      for (const p of lu[band] || []) push(p.name);
    }
  }
  return names;
}

function captionMentionsMatch(text, home, away, match) {
  const t = String(text || "").toLowerCase();
  const terms = [
    home,
    away,
    ...playerNamesFromMatch(match),
  ]
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 2);
  return terms.some((term) => t.includes(term));
}

function engagementScore(metrics) {
  const m = metrics || {};
  return (
    (m.like_count || 0) +
    (m.retweet_count || 0) * 2 +
    (m.quote_count || 0) * 2 +
    (m.reply_count || 0) * 0.25
  );
}

function postMatchWindow(kickoffUtc) {
  const kickoff = Date.parse(kickoffUtc || "");
  if (isNaN(kickoff)) return null;
  const now = Date.now();
  const contextEnd = kickoff + MEME_MATCH_CONTEXT_MS;
  return {
    start: new Date(kickoff - MEME_LOOKBACK_BEFORE_KICKOFF_MS).toISOString(),
    end: new Date(Math.min(Math.max(now, kickoff + MATCH_DURATION_MS), contextEnd)).toISOString(),
  };
}

function tweetInWindow(createdAt, window) {
  if (!window || !createdAt) return false;
  const t = Date.parse(createdAt);
  const s = Date.parse(window.start);
  const e = Date.parse(window.end);
  return t >= s && t <= e;
}

async function fetchTimelineSyndication(screenName, limit = 40) {
  const url = `${SYNDICATION}/${encodeURIComponent(screenName)}?dnt=false&lang=en&limit=${limit}`;
  const html = await fetchText(url);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  const entries = data?.props?.pageProps?.timeline?.entries || [];
  return entries
    .filter((e) => e.type === "tweet")
    .map((e) => {
      const c = e.content || {};
      const tweet = c.tweet || c;
      const id = (e.entry_id || "").replace(/^tweet-/, "") || tweet.id_str || tweet.id;
      const text = tweet.text || tweet.full_text || "";
      if (!id) return null;
      const metrics = tweet.public_metrics || {};
      return {
        id: String(id),
        text,
        created_at: tweet.created_at || tweet.date || null,
        syndication_media: tweet.mediaDetails || tweet.entities?.media || [],
        user: tweet.user || null,
        public_metrics: metrics || tweet.favorite_count != null
          ? { like_count: tweet.favorite_count || 0, retweet_count: tweet.retweet_count || 0 }
          : {},
      };
    })
    .filter(Boolean);
}

async function fetchUserTweetsInRange(token, userId, startTime, endTime, username, opts = {}) {
  const syndicationOnly = !!opts.syndicationOnly;
  if (token && userId && !syndicationOnly) {
    const params = new URLSearchParams({
      max_results: "30",
      "tweet.fields": "created_at,public_metrics,author_id",
      start_time: startTime,
      end_time: endTime,
      exclude: "retweets,replies",
    });
    try {
      const json = await twitterGet(`/users/${userId}/tweets?${params}`, token);
      if (Array.isArray(json.data) && json.data.length) return json.data;
    } catch { /* fall through to syndication */ }
  }
  if (!username) return [];
  const tweets = await fetchTimelineSyndication(username, 50);
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  return tweets.filter((t) => {
    const ts = Date.parse(t.created_at || "");
    return !isNaN(ts) && ts >= start && ts <= end;
  });
}

function mediaFromSyndication(items) {
  return (items || []).map((m) => {
    const previewUrl = m.media_url_https || m.media_url || m.preview_image_url || "";
    const type = m.type === "video" ? "video" : m.type === "animated_gif" ? "animated_gif" : "photo";
    let url = previewUrl;
    if ((type === "video" || type === "animated_gif") && m.video_info?.variants) {
      const mp4 = m.video_info.variants
        .filter((v) => v.content_type === "video/mp4" && v.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      url = mp4[0]?.url || previewUrl;
    }
    if (!previewUrl && !url) return null;
    return { type, previewUrl: previewUrl || url, url: url || previewUrl };
  }).filter(Boolean);
}

function toMemeEntry(tweet, username) {
  const metrics = tweet.public_metrics || {};
  const user = tweet.user || {};
  return {
    type: "tweet",
    url: `https://x.com/${username}/status/${tweet.id}`,
    text: tweet.text || "",
    author: username,
    tweetId: String(tweet.id),
    likes: metrics.like_count || 0,
    retweets: metrics.retweet_count || 0,
    engagement: Math.round(engagementScore(metrics)),
    postedAt: tweet.created_at || null,
    avatarUrl: user.profile_image_url_https || user.profile_image_url || null,
    media: mediaFromSyndication(tweet.syndication_media || []),
  };
}

/** Top 3 per curated account for one ended match. */
async function discoverMatchMemes(home, away, opts = {}) {
  const token = normalizeBearer(opts.bearerToken || process.env.TWITTER_BEARER_TOKEN);
  const match = opts.match || { home, away, kickoffUtc: opts.kickoffUtc };
  const window = postMatchWindow(match.kickoffUtc || opts.kickoffUtc);
  if (!window) return [];

  const accounts = token ? await resolveMemeUserIds(token) : loadCachedUserIds().accounts || {};
  const results = [];

  for (const src of memeSources()) {
    const acct = accounts[src.key] || { id: null, username: src.username };
    let tweets;
    try {
      tweets = await fetchUserTweetsInRange(token, acct.id, window.start, window.end, acct.username || src.username);
    } catch {
      continue;
    }
    const hits = tweets
      .filter((t) => captionMentionsMatch(t.text, home, away, match))
      .map((t) => ({ tweet: t, engagement: engagementScore(t.public_metrics) }))
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, topPerAccount())
      .map(({ tweet }) => toMemeEntry(tweet, acct.username));
    results.push(...hits);
  }
  return results;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Batch-fetch by kickoff UTC day — only used when TWITTER_FETCH_ALL=1 (expensive). */
async function discoverAllMatchMemes(matches, opts = {}) {
  const token = normalizeBearer(opts.bearerToken || process.env.TWITTER_BEARER_TOKEN);
  const out = {};
  const ended = matches.filter((m) => m.status === "ended" && m.kickoffUtc);
  if (!token || !ended.length) return out;

  const accounts = await resolveMemeUserIds(token);
  const byDay = new Map();
  for (const m of ended) {
    const day = String(m.kickoffUtc).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(m);
  }

  const tweetsByAccountDay = new Map();

  for (const [day, dayMatches] of byDay) {
    let rangeStart = Infinity;
    let rangeEnd = -Infinity;
    for (const m of dayMatches) {
      const w = postMatchWindow(m.kickoffUtc);
      if (!w) continue;
      rangeStart = Math.min(rangeStart, Date.parse(w.start));
      rangeEnd = Math.max(rangeEnd, Date.parse(w.end));
    }
    if (!isFinite(rangeStart)) continue;
    const startTime = new Date(rangeStart).toISOString();
    const endTime = new Date(rangeEnd).toISOString();

    await Promise.all(
      memeSources().map(async (src) => {
        const acct = accounts[src.key];
        if (!acct || !acct.id) return;
        const cacheKey = `${src.key}:${day}`;
        try {
          const tweets = await fetchUserTweetsInRange(token, acct.id, startTime, endTime, acct.username);
          tweetsByAccountDay.set(cacheKey, { username: acct.username, tweets });
        } catch (err) {
          console.warn(`tweets fetch failed @${acct.username} ${day}:`, err.message);
          tweetsByAccountDay.set(cacheKey, { username: acct.username, tweets: [] });
        }
      })
    );
  }

  for (const m of ended) {
    const key = m.key || `${m.home}~${m.away}`;
    const window = postMatchWindow(m.kickoffUtc);
    if (!window) continue;
    const day = String(m.kickoffUtc).slice(0, 10);
    const memes = [];

    for (const src of memeSources()) {
      const cacheKey = `${src.key}:${day}`;
      const bucket = tweetsByAccountDay.get(cacheKey);
      if (!bucket) continue;
      const hits = bucket.tweets
        .filter((t) => tweetInWindow(t.created_at, window))
        .filter((t) => captionMentionsMatch(t.text, m.home, m.away, m))
        .map((t) => ({ tweet: t, engagement: engagementScore(t.public_metrics) }))
        .sort((a, b) => b.engagement - a.engagement)
        .slice(0, topPerAccount())
        .map(({ tweet }) => toMemeEntry(tweet, bucket.username));
      memes.push(...hits);
    }
    if (memes.length) out[key] = memes;
  }
  return out;
}

/**
 * Low-credit path: latest N ended matches that already have a ملخص and no
 * pinned memes yet. Uses X API when a bearer token exists, otherwise falls
 * back to syndication timelines.
 */
async function discoverLatestHighlightMemes(matches, opts = {}) {
  const token = normalizeBearer(opts.bearerToken || process.env.TWITTER_BEARER_TOKEN);

  const pinned = opts.pinnedMemes || {};
  const maxMatches = opts.maxMatches ?? 6;
  const candidates = matches
    .filter((m) => m.status === "ended" && m.highlight?.videoUrl && m.kickoffUtc)
    .filter((m) => !(pinned[m.key] || []).length)
    .sort((a, b) => Date.parse(b.kickoffUtc) - Date.parse(a.kickoffUtc))
    .slice(0, maxMatches);

  if (!candidates.length) {
    console.log("No highlight matches need meme discovery (all pinned or none with ملخص).");
    return {};
  }

  const out = {};
  for (const m of candidates) {
    console.log(`Twitter: discovering memes for ${m.home} vs ${m.away}`);
    try {
      const hits = await discoverMatchMemes(m.home, m.away, {
        match: m,
        kickoffUtc: m.kickoffUtc,
        bearerToken: token,
      });
      if (hits.length) out[m.key] = hits;
      await sleep(600);
    } catch (err) {
      console.warn(`memes skipped for ${m.key}:`, err.message);
    }
  }
  return out;
}

module.exports = {
  memeSources,
  topPerAccount,
  resolveMemeUserIds,
  discoverMatchMemes,
  discoverAllMatchMemes,
  discoverLatestHighlightMemes,
  postMatchWindow,
  captionMentionsMatch,
  engagementScore,
};
