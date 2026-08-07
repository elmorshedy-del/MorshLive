/**
 * Parse filgoal.com /videos/{id} pages — YouTube or Dailymotion embed + og:title/image.
 * filgoal publishes one clip per fixture event (ملخص full recap, أهداف multi-goal
 * reel, or a single هدف clip) and embeds a third-party player rather than hosting
 * video itself, so a numeric-id-only URL (no slug) is enough to resolve the page.
 */
const YOUTUBE_EMBED_RE = /(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([\w-]{11})/i;
const DAILYMOTION_EMBED_RE = /dailymotion\.com\/(?:embed\/video|video)\/([A-Za-z0-9]+)/i;

function youtubeEmbedUrl(id) {
  return `https://www.youtube.com/embed/${id}`;
}

function dailymotionEmbedUrl(id) {
  return `https://www.dailymotion.com/embed/video/${id}`;
}

/** Reads a meta tag's content regardless of whether property/name comes before content. */
function parseMetaContent(html, key) {
  const text = String(html || "");
  const attr = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]*(?:property|name)=["']${attr}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${attr}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].replace(/&amp;/g, "&").trim();
  }
  return "";
}

/** { source: "youtube"|"dailymotion", embedId, videoUrl } | null. */
function extractFilgoalMedia(html) {
  const text = String(html || "");

  const yt = text.match(YOUTUBE_EMBED_RE);
  if (yt) return { source: "youtube", embedId: yt[1], videoUrl: youtubeEmbedUrl(yt[1]) };

  const dm = text.match(DAILYMOTION_EMBED_RE);
  if (dm) return { source: "dailymotion", embedId: dm[1], videoUrl: dailymotionEmbedUrl(dm[1]) };

  return null;
}

function extractFilgoalTitle(html) {
  return parseMetaContent(html, "og:title");
}

function extractFilgoalThumbnail(html) {
  return parseMetaContent(html, "og:image");
}

function extractFilgoalPublishedAt(html) {
  const m = String(html || "").match(/"datePublished"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

module.exports = {
  extractFilgoalMedia,
  extractFilgoalTitle,
  extractFilgoalThumbnail,
  extractFilgoalPublishedAt,
  parseMetaContent,
  youtubeEmbedUrl,
  dailymotionEmbedUrl,
};
