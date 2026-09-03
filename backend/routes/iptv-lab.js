import { corsPreflightResponse, jsonResponse } from "../http/response.js";
import {
  getIptvLabCatalog,
  getIptvLabCategories,
  getIptvLabEpg,
  getIptvLabLive,
  getIptvLabStatus,
  probeIptvLabChannel,
} from "../services/iptv-lab.js";

const API_RE = /^\/api\/iptv-lab\/(status|categories|catalog|epg|live|probe)\/?$/i;

export const iptvLabRoute = {
  name: "iptv-lab",
  methods: ["GET", "HEAD", "OPTIONS"],
  test: (url) => API_RE.test(url.pathname),
  async handle({ env, url, method }) {
    if (method === "OPTIONS") return corsPreflightResponse();

    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "X-KZ-Proxy": "iptv-lab",
        },
      });
    }

    const action = url.pathname.match(API_RE)[1].toLowerCase();
    const result =
      action === "status"
        ? await getIptvLabStatus(env, url.searchParams)
        : action === "categories"
          ? await getIptvLabCategories(env, url.searchParams)
          : action === "catalog"
            ? await getIptvLabCatalog(env)
            : action === "epg"
              ? await getIptvLabEpg(env)
              : action === "probe"
                ? await probeIptvLabChannel(env, url.searchParams)
                : await getIptvLabLive(env, url.searchParams);

    return jsonResponse(result.body, {
      status: result.status,
      cacheSeconds: action === "epg" ? 20 : 0,
      proxyTag: "iptv-lab",
    });
  },
};
