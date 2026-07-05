/* ============================================================================
 * twitter-memes-lib.js — viral X/Twitter posts via syndication timeline API
 * (no API key; reads public embed timelines from football meme accounts).
 * ==========================================================================*/
const https = require("https");
const SYNDICATION = "https://syndication.twitter.com/srv/timeline-profile/screen-name";
const UA = "Mozilla/5.0 (compatible; MorshLive/1.0)";

/** Football accounts that post match memes / viral moments during World Cup. */
const MEME_ACCOUNTS = [
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

function namesForTeam(team) {
  const base = [team];
  const aliases = TEAM_ALIASES[team] || [];
  return [...base, ...aliases].map((s) => s.toLowerCase());
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
  if (/😂|🤣|💀|😭|🔥|meme|viral/i.test(tweet.text)) score += 2;
  if (tweet.text.length > 40) score += 1;
  return score;
}

/** Fetch timelines once, then match tweets to home vs away. */
async function discoverMatchMemes(home, away, { max = 4 } = {}) {
  const seen = new Set();
  const hits = [];
  for (const acct of MEME_ACCOUNTS) {
    let tweets;
    try { tweets = await fetchTimeline(acct, 40); } catch { continue; }
    for (const tw of tweets) {
      if (seen.has(tw.id)) continue;
      if (!tweetMatchesMatch(tw, home, away)) continue;
      seen.add(tw.id);
      hits.push({ ...tw, type: "tweet", score: scoreTweet(tw) });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, max).map(({ id, url, text, author, type }) => ({
    type,
    url,
    text,
    author,
    tweetId: id,
  }));
}

/** Build full memes map for many matches (one timeline fetch per account). */
async function discoverAllMatchMemes(matches, { maxPerMatch = 3 } = {}) {
  const timelines = new Map();
  for (const acct of MEME_ACCOUNTS) {
    try {
      timelines.set(acct, await fetchTimeline(acct, 50));
    } catch {
      timelines.set(acct, []);
    }
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

  const out = {};
  for (const m of matches) {
    if (m.status !== "ended") continue;
    const hits = allTweets
      .filter((tw) => tweetMatchesMatch(tw, m.home, m.away))
      .map((tw) => ({ ...tw, score: scoreTweet(tw) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPerMatch)
      .map(({ id, url, text, author }) => ({
        type: "tweet",
        url,
        text,
        author,
        tweetId: id,
      }));
    if (hits.length) out[m.key || `${m.home}~${m.away}`] = hits;
  }
  return out;
}

module.exports = {
  MEME_ACCOUNTS,
  discoverMatchMemes,
  discoverAllMatchMemes,
  fetchTimeline,
  tweetMatchesMatch,
};
