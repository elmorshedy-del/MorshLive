import { proxyXtreamMedia, redirectXtreamMedia } from "../adapters/xtream.js";
import { corsPreflightResponse, errorResponse, jsonResponse } from "../http/response.js";
import {
  getDirectStreams,
  getXtreamCategories,
  getXtreamLive,
  getXtreamStatus,
  probeXtreamChannel,
} from "../services/xtream.js";

const API_RE = /^\/api\/xtream\/(status|categories|live|probe|direct-streams)\/?$/i;
const MEDIA_RE = /^\/api\/xtream\/media\/([A-Za-z0-9_-]+)\/?$/;
const DIRECT_RE = /^\/api\/xtream\/direct\/([A-Za-z0-9_-]+)\/?$/;

export const xtreamRoute = {
  name: "xtream",
  methods: ["GET", "HEAD", "OPTIONS"],
  test: (url) => API_RE.test(url.pathname) || MEDIA_RE.test(url.pathname) || DIRECT_RE.test(url.pathname),
  async handle({ request, env, url, method }) {
    if (method === "OPTIONS") return corsPreflightResponse();

    const direct = url.pathname.match(DIRECT_RE);
    if (direct) {
      try {
        return await redirectXtreamMedia(env, direct[1]);
      } catch (error) {
        return errorResponse(String(error.message || error), 403, "xtream-direct");
      }
    }

    const media = url.pathname.match(MEDIA_RE);
    if (media) {
      try {
        return await proxyXtreamMedia(request, env, media[1]);
      } catch (error) {
        const message = String(error.message || error);
        const status = /expired|invalid/i.test(message) ? 403 : 502;
        return errorResponse(message, status, "xtream-media");
      }
    }

    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "X-KZ-Proxy": "xtream",
        },
      });
    }

    const action = url.pathname.match(API_RE)[1].toLowerCase();
    const result =
      action === "status"
        ? await getXtreamStatus(env, url.searchParams)
        : action === "categories"
          ? await getXtreamCategories(env, url.searchParams)
          : action === "probe"
            ? await probeXtreamChannel(env, url.searchParams)
            : action === "direct-streams"
              ? await getDirectStreams(env, url.searchParams)
              : await getXtreamLive(env, url.searchParams);

    return jsonResponse(result.body, {
      status: result.status,
      cacheSeconds: 0,
      proxyTag: "xtream",
    });
  },
};
