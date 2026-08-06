/**
 * Parse btolat.com /video/{id} pages — vortex embed URL or beIN X tweet id.
 */
const VORTEX_EMBED_BASE = "https://nvtboo.vortexvisionworks.com/embed";

function twitterTweetEmbedUrl(tweetId) {
  return `https://platform.twitter.com/embed/Tweet.html?id=${tweetId}&dnt=true`;
}

function extractBtolatMedia(html) {
  const text = String(html || "");

  const urlEmbed = text.match(
    /embedURL"\s*:\s*"(https?:\/\/[^"]*vortexvisionworks\.com\/embed\/([A-Za-z0-9]+))/i,
  );
  if (urlEmbed) {
    const videoUrl = urlEmbed[1].replace(/\\\//g, "/");
    return { source: "vortex", embedId: urlEmbed[2], videoUrl };
  }

  const inline = text.match(/vortexvisionworks\.com\/embed\/([A-Za-z0-9]+)/i);
  if (inline) {
    return {
      source: "vortex",
      embedId: inline[1],
      videoUrl: `${VORTEX_EMBED_BASE}/${inline[1]}`,
    };
  }

  const tweetLink = text.match(/(?:twitter|x)\.com\/\w+\/status\/(\d{10,})/i);
  const tweetJson = text.match(/embedURL"\s*:\s*"(\d{15,})"/);
  const tweetId = tweetLink?.[1] || tweetJson?.[1];
  if (tweetId) {
    return {
      source: "twitter",
      tweetId,
      videoUrl: twitterTweetEmbedUrl(tweetId),
    };
  }

  return null;
}

module.exports = {
  VORTEX_EMBED_BASE,
  extractBtolatMedia,
  twitterTweetEmbedUrl,
};
