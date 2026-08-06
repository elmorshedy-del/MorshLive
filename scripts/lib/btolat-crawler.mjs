/**
 * btolat.com video crawler — CheerioCrawler (https://github.com/apify/crawlee)
 * Deterministic HTML scrape: feed cards → video pages → vortex embed + date.
 */
import { createRequire } from "node:module";
import { CheerioCrawler } from "crawlee";

const require = createRequire(import.meta.url);
const { extractBtolatMedia } = require("./btolat-media.js");

const UA = "Mozilla/5.0 (compatible; MorshLive-BtolatCrawler/1.0)";
const FEEDS = [
  "https://www.btolat.com/league/1056/world-cup",
  "https://www.btolat.com/videos",
];
const SITEMAP_URL = "https://www.btolat.com/sitemap.xml";

async function fetchBtolatSitemapVideoIds() {
  try {
    const res = await fetch(SITEMAP_URL, {
      headers: { "User-Agent": UA, Accept: "text/xml,text/plain,*/*" },
      redirect: "follow",
    });
    if (!res.ok) return [];
    const text = await res.text();
    return [...text.matchAll(/video\/(\d+)/g)].map((m) => m[1]);
  } catch {
    return [];
  }
}

function parseFeedCards(html, baseUrl) {
  const out = [];
  for (const m of String(html || "").matchAll(/href=['"]\/video\/(\d+)['"][\s\S]{0,500}?<h3>([^<]+)<\/h3>/g)) {
    out.push({ btolatId: m[1], title: m[2].trim(), feedUrl: baseUrl });
  }
  return out;
}

function extractEmbedId(html) {
  const media = extractBtolatMedia(html);
  return media?.embedId || media?.tweetId || null;
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
export async function crawlBtolatVideos({ maxVideos = 120, useSitemap = false } = {}) {
  const byId = new Map();
  const seedVideos = [];

  if (useSitemap) {
    const sitemapIds = await fetchBtolatSitemapVideoIds();
    for (const btolatId of sitemapIds) {
      if (!byId.has(btolatId)) {
        byId.set(btolatId, {
          btolatId,
          title: "",
          embedId: null,
          publishedAt: null,
          feedUrl: SITEMAP_URL,
        });
        seedVideos.push(btolatId);
      }
    }
  }

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: maxVideos + FEEDS.length + seedVideos.length + 5,
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
        const media = extractBtolatMedia($.html());
        const embedId = media?.embedId || media?.tweetId || null;
        const publishedAt = extractPublishedAt($.html());
        const pageTitle = $("h1").first().text().trim();
        const prev = byId.get(btolatId) || {
          btolatId,
          title: request.userData.title || "",
          feedUrl: request.userData.feedUrl,
        };
        byId.set(btolatId, {
          ...prev,
          title: pageTitle || prev.title,
          embedId,
          media,
          publishedAt,
        });
      }
    },
  });

  await crawler.run([
    ...FEEDS.map((url) => ({ url, userData: { label: "feed" } })),
    ...seedVideos.map((btolatId) => ({
      url: `https://www.btolat.com/video/${btolatId}`,
      userData: { label: "video", btolatId, title: "", feedUrl: SITEMAP_URL },
    })),
  ]);

  return [...byId.values()]
    .filter((v) => v.media || v.embedId)
    .slice(0, maxVideos);
}
