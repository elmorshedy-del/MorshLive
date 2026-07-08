/**
 * btolat.com video crawler — CheerioCrawler (https://github.com/apify/crawlee)
 * Deterministic HTML scrape: feed cards → video pages → vortex embed + date.
 */
import { CheerioCrawler } from "crawlee";

const UA = "Mozilla/5.0 (compatible; MorshLive-BtolatCrawler/1.0)";
const FEEDS = [
  "https://www.btolat.com/league/1056/world-cup",
  "https://www.btolat.com/videos",
];

function parseFeedCards(html, baseUrl) {
  const out = [];
  for (const m of String(html || "").matchAll(/href=['"]\/video\/(\d+)['"][\s\S]{0,500}?<h3>([^<]+)<\/h3>/g)) {
    out.push({ btolatId: m[1], title: m[2].trim(), feedUrl: baseUrl });
  }
  return out;
}

function extractEmbedId(html) {
  const m = String(html || "").match(/vortexvisionworks\.com\/embed\/([A-Za-z0-9]+)/i);
  return m ? m[1] : null;
}

function extractPublishedAt(html) {
  const time = String(html || "").match(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (time) return time[1];
  const meta = String(html || "").match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i);
  return meta ? meta[1] : null;
}

/**
 * @returns {Promise<Array<{ btolatId, title, embedId, publishedAt, feedUrl }>>}
 */
export async function crawlBtolatVideos({ maxVideos = 120 } = {}) {
  const byId = new Map();

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: maxVideos + FEEDS.length + 5,
    maxConcurrency: 4,
    requestHandlerTimeoutSecs: 45,
    additionalMimeTypes: ["text/html"],
    preNavigationHooks: [
      async ({ request }) => {
        request.headers = { ...(request.headers || {}), "User-Agent": UA, Accept: "text/html,*/*" };
      },
    ],
    async requestHandler({ request, $, enqueueLinks }) {
      const label = request.userData?.label || "feed";
      if (label === "feed") {
        const cards = parseFeedCards($.html(), request.url);
        for (const card of cards) {
          if (byId.has(card.btolatId)) continue;
          byId.set(card.btolatId, { ...card, embedId: null, publishedAt: null });
          await enqueueLinks({
            urls: [`https://www.btolat.com/video/${card.btolatId}`],
            userData: { label: "video", btolatId: card.btolatId, title: card.title, feedUrl: request.url },
          });
        }
        return;
      }

      if (label === "video") {
        const btolatId = request.userData.btolatId;
        const embedId = extractEmbedId($.html());
        const publishedAt = extractPublishedAt($.html());
        const prev = byId.get(btolatId) || {
          btolatId,
          title: request.userData.title || "",
          feedUrl: request.userData.feedUrl,
        };
        byId.set(btolatId, { ...prev, embedId, publishedAt });
      }
    },
  });

  await crawler.run(FEEDS.map((url) => ({ url, userData: { label: "feed" } })));

  return [...byId.values()]
    .filter((v) => v.embedId)
    .slice(0, maxVideos);
}
