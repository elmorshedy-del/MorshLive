#!/usr/bin/env node
/**
 * Backfill avatarUrl + media on match-memes.json using Twitter syndication (no API token).
 * Keeps only tweets with photo/video/GIF previews.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const MEMES_PATH = path.join(__dirname, "..", "assets", "data", "match-memes.json");
const PINNED_PATH = path.join(__dirname, "..", "assets", "data", "pinned-match-memes.json");
const ARCHIVE_PATH = path.join(__dirname, "..", "assets", "data", "tournament-archive.json");
const UA = "Mozilla/5.0 (compatible; KoraZero/1.0)";

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA } }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function memeHasMedia(meme) {
  const item = (meme?.media || [])[0];
  return !!(item && (item.previewUrl || item.url));
}

function filterMediaOnly(memesByKey) {
  const out = {};
  for (const [key, list] of Object.entries(memesByKey || {})) {
    const kept = (list || []).filter(memeHasMedia);
    if (kept.length) out[key] = kept;
  }
  return out;
}

function mediaFromSyndication(items) {
  return (items || []).map((m) => {
    const previewUrl = m.media_url_https || m.media_url || "";
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

async function enrichMeme(meme) {
  if (!meme.tweetId || (meme.media && meme.media.length && meme.avatarUrl)) return meme;
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(meme.tweetId)}&lang=en&token=0`;
  try {
    const synd = await fetchJson(url);
    const media = mediaFromSyndication(synd.mediaDetails || []);
    const user = synd.user || {};
    return {
      ...meme,
      avatarUrl: user.profile_image_url_https || user.profile_image_url || meme.avatarUrl || null,
      media: media.length ? media : (meme.media || []),
    };
  } catch {
    return meme;
  }
}

async function enrichMap(memesByKey) {
  const out = {};
  for (const key of Object.keys(memesByKey)) {
    const list = memesByKey[key] || [];
    const enriched = [];
    for (const meme of list) {
      enriched.push(await enrichMeme(meme));
      await new Promise((r) => setTimeout(r, 120));
    }
    out[key] = enriched;
  }
  return out;
}

(async () => {
  const memes = JSON.parse(fs.readFileSync(MEMES_PATH, "utf8"));
  console.log("Enriching match-memes.json …");
  const enriched = filterMediaOnly(await enrichMap(memes));
  fs.writeFileSync(MEMES_PATH, JSON.stringify(enriched, null, 2) + "\n");

  if (fs.existsSync(PINNED_PATH)) {
    const pinned = filterMediaOnly(JSON.parse(fs.readFileSync(PINNED_PATH, "utf8")));
    fs.writeFileSync(PINNED_PATH, JSON.stringify(pinned, null, 2) + "\n");
    console.log("Updated pinned-match-memes.json (media-only)");
  }

  if (fs.existsSync(ARCHIVE_PATH)) {
    const archive = JSON.parse(fs.readFileSync(ARCHIVE_PATH, "utf8"));
    archive.memes = filterMediaOnly({ ...(archive.memes || {}), ...enriched });
    fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(archive, null, 2) + "\n");
    console.log("Updated tournament-archive.json memes (media-only)");
  }

  const withMedia = Object.values(enriched).flat().length;
  console.log(`Done: ${withMedia} media tweets kept`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
