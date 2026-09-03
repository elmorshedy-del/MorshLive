import { proxyXtreamMedia, redirectXtreamMedia } from "../adapters/xtream.js";
import { corsPreflightResponse, errorResponse, jsonResponse } from "../http/response.js";
import { iptvLabWorkerEnv } from "../../lib/iptv-lab.js";
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

function routedPortalEnv(env, searchParams, action) {
  if (action === "direct-streams" || String(searchParams.get("portal") || "") !== "lab") {
    return { env, searchParams };
  }
  const lab = iptvLabWorkerEnv(env);
  if (!lab.ok) return { error: lab.error, status: 404 };
  const params = new URLSearchParams(searchParams);
  params.delete("portal");
  return { env: lab.env, searchParams: params, lab: true };
}

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
    const routed = routedPortalEnv(env, url.searchParams, action);
    if (routed.error) {
      return jsonResponse(
        { ok: false, error: routed.error, isolated: true, source: "IPTV_LAB_JSON" },
        { status: routed.status, cacheSeconds: 0, proxyTag: "xtream-lab" },
      );
    }

    const result =
      action === "status"
        ? await getXtreamStatus(routed.env, routed.searchParams)
        : action === "categories"
          ? await getXtreamCategories(routed.env, routed.searchParams)
          : action === "probe"
            ? await probeXtreamChannel(routed.env, routed.searchParams)
            : action === "direct-streams"
              ? await getDirectStreams(routed.env, routed.searchParams)
              : await getXtreamLive(routed.env, routed.searchParams);

    return jsonResponse(result.body, {
      status: result.status,
      cacheSeconds: 0,
      proxyTag: routed.lab ? "xtream-lab" : "xtream",
    });
  },
};
