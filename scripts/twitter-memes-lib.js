/* ============================================================================
 * twitter-memes-lib.js — viral X/Twitter posts
 * 1) X API v2 recent search when TWITTER_BEARER_TOKEN is set
 * 2) Syndication timeline fallback (football meme accounts, no key)
 * ==========================================================================*/
const https = require("https");
const SYNDICATION = "https://syndication.twitter.com/srv/timeline-profile/screen-name";
const TWITTER_SEARCH = "https://api.twitter.com/2/tweets/search/recent";
const UA = "Mozilla/5.0 (compatible; MorshLive/1.0)";

/** Football + site-owner accounts scanned for match memes / viral moments. */
const MEME_ACCOUNTS = [
  "Ahmed06209123",
  "brfootball",
  "TFRHQ5",
  "433",
  "Sporf",
  "ESPNFC",
  "FootyHumour",
  "IndoFootball",
];

const TEAM_ALIASES = {
  "United States": ["USA", "USMNT", "America"],
  France: ["Les Bleus", "Mbappé", "Mbappe"],
  Paraguay: ["La Albirroja", "Albirroja"],
  Morocco: ["Atlas Lions", "المغرب"],
  Canada: ["CanMNT"],
  Brazil: ["Seleção", "Selecao"],
  Germany: ["Die Mannschaft"],
  Argentina: ["Albiceleste", "Messi"],
  England: ["Three Lions"],
  Portugal: ["Ronaldo"],
};

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": UA, ...headers } }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 200)}`));
            return;
          }
          resolve(d);
        });
      })
      .on("error", reject);
  });
}

function normalizeBearer(token) {
  if (!token) return "";
  return String(token).trim();
}

function namesForTeam(team) {
  const base = [team];
  const aliases = TEAM_ALIASES[team] || [];
  return [...base, ...aliases].map((s) => s.toLowerCase());
}

function buildTwitterSearchQuery(home, away) {
  const terms = [...new Set([...namesForTeam(home), ...namesForTeam(away)])]
    .filter((t) => t.length > 2)
    .slice(0, 4)
    .map((t) => (t.includes(" ") ? `"${t}"` : t));
  const teamQ = terms.join(" OR ");
  return `(${teamQ}) (world cup OR fifa OR meme OR viral OR goal) -is:retweet lang:en`;
}

function tweetMatchesMatch(tweet, home, away) {
  const text = (tweet.text || "").toLowerCase();
  const homeHits = namesForTeam(home).some((n) => text.includes(n));
  const awayHits = namesForTeam(away).some((n) => text.includes(n));
  if (homeHits && awayHits) return true;
  if (homeHits && /world cup|كأس العالم|fifa/i.test(text)) return true;
  if (awayHits && /world cup|كأس العالم|fifa/i.test(text)) return true;
  return false;
}

function scoreTweet(tweet) {
  let score = 0;
  if (tweet.hasMedia) score += 3;
  if (/😂|🤣|💀|😭|🔥|meme|viral/i.test(tweet.text || "")) score += 2;
  if ((tweet.text || "").length > 40) score += 1;
  const m = tweet.metrics || {};
  score += Math.min(5, Math.floor(((m.like_count || 0) + (m.retweet_count || 0) * 2) / 500));
  return score;
}

function toMemeEntry(tw) {
  return {
    type: "tweet",
    url: tw.url,
    text: tw.text,
    author: tw.author,
    tweetId: tw.id,
    likes: tw.metrics?.like_count,
  };
}

/** X API v2 recent search — needs TWITTER_BEARER_TOKEN. */
async function searchTwitterApi(bearerToken, home, away, { max = 5 } = {}) {
  const token = normalizeBearer(bearerToken);
  if (!token) return [];
  const params = new URLSearchParams({
    query: buildTwitterSearchQuery(home, away),
    max_results: "10",
    "tweet.fields": "public_metrics,created_at,author_id",
    expansions: "author_id",
    "user.fields": "username",
  });
  const url = `${TWITTER_SEARCH}?${params.toString()}`;
  let json;
  try {
    const body = await fetchText(url, { Authorization: `Bearer ${token}` });
    json = JSON.parse(body);
  } catch {
    return [];
  }
  if (!json.data || !Array.isArray(json.data)) return [];
  const users = new Map((json.includes?.users || []).map((u) => [u.id, u.username]));
  return json.data
    .map((t) => {
      const author = users.get(t.author_id) || "i";
      return {
        id: String(t.id),
        text: t.text || "",
        url: `https://x.com/${author}/status/${t.id}`,
        author,
        hasMedia: /pic\.twitter\.com|https:\/\/t\.co/.test(t.text || ""),
        metrics: t.public_metrics,
      };
    })
    .filter((tw) => tweetMatchesMatch(tw, home, away))
    .map((tw) => ({ ...tw, score: scoreTweet(tw) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(toMemeEntry);
}

async function fetchTimeline(screenName, limit = 30) {
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
      const user = tweet.user?.screen_name || tweet.author?.screen_name || screenName;
      if (!id) return null;
      return {
        id: String(id),
        text,
        url: `https://x.com/${user}/status/${id}`,
        author: user,
        hasMedia: /pic\.twitter\.com|video\.twimg|https:\/\/t\.co/.test(text),
      };
    })
    .filter(Boolean);
}

async function discoverFromSyndication(home, away, { max = 4 } = {}) {
  const seen = new Set();
  const hits = [];
  for (const acct of MEME_ACCOUNTS) {
    let tweets;
    try { tweets = await fetchTimeline(acct, 40); } catch { continue; }
    for (const tw of tweets) {
      if (seen.has(tw.id)) continue;
      if (!tweetMatchesMatch(tw, home, away)) continue;
      seen.add(tw.id);
      hits.push({ ...tw, score: scoreTweet(tw) });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, max).map(toMemeEntry);
}

/** Find viral tweets for one match — API first, syndication fallback. */
async function discoverMatchMemes(home, away, { max = 4, bearerToken } = {}) {
  const token = bearerToken || process.env.TWITTER_BEARER_TOKEN;
  if (token) {
    const api = await searchTwitterApi(token, home, away, { max });
    if (api.length) return api;
  }
  return discoverFromSyndication(home, away, { max });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Build full memes map for many matches. */
async function discoverAllMatchMemes(matches, { maxPerMatch = 3, bearerToken } = {}) {
  const token = bearerToken || process.env.TWITTER_BEARER_TOKEN;
  const out = {};
  const ended = matches.filter((m) => m.status === "ended");

  if (token) {
    for (const m of ended) {
      const key = m.key || `${m.home}~${m.away}`;
      try {
        const api = await searchTwitterApi(token, m.home, m.away, { max: maxPerMatch });
        if (api.length) out[key] = api;
        await sleep(350);
      } catch { /* rate limit — continue */ }
    }
  }

  const timelines = new Map();
  for (const acct of MEME_ACCOUNTS) {
    try { timelines.set(acct, await fetchTimeline(acct, 50)); } catch { timelines.set(acct, []); }
  }
  const allTweets = [];
  const seen = new Set();
  for (const tweets of timelines.values()) {
    for (const tw of tweets) {
      if (seen.has(tw.id)) continue;
      seen.add(tw.id);
      allTweets.push(tw);
    }
  }

  for (const m of ended) {
    const key = m.key || `${m.home}~${m.away}`;
    const existing = out[key] || [];
    if (existing.length >= maxPerMatch) continue;
    const hits = allTweets
      .filter((tw) => tweetMatchesMatch(tw, m.home, m.away))
      .map((tw) => ({ ...tw, score: scoreTweet(tw) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPerMatch - existing.length)
      .map(toMemeEntry);
    if (hits.length || existing.length) out[key] = [...existing, ...hits].slice(0, maxPerMatch);
  }
  return out;
}

module.exports = {
  MEME_ACCOUNTS,
  discoverMatchMemes,
  discoverAllMatchMemes,
  searchTwitterApi,
  fetchTimeline,
  tweetMatchesMatch,
  buildTwitterSearchQuery,
};
