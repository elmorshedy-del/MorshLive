import { corsPreflightResponse, jsonResponse } from "../http/response.js";
import {
  getIptvLabCatalog,
  getIptvLabCategories,
  getIptvLabChannel,
  getIptvLabEpg,
  getIptvLabLive,
  getIptvLabStatus,
  probeIptvLabChannel,
} from "../services/iptv-lab.js";

const API_RE = /^\/api\/iptv-lab\/(status|categories|catalog|channel|epg|live|probe)\/?$/i;

/**
 * Actions that hand back something playable, or that open a provider
 * connection themselves. `live` and `channel` mint signed /api/xtream/media
 * URLs; `probe` opens a real /live/ request and so takes the account's single
 * connection slot on its own.
 */
const MINTS_PLAYBACK = new Set(["live", "channel", "probe"]);

/**
 * These were reachable by anyone, from anywhere, with no browser involved —
 * verified by calling them from a bare container with no Origin and no
 * Referer. That made the line a public IPTV proxy: rotating the signing secret
 * or expiring a token achieves nothing while a fresh, valid URL is one
 * unauthenticated GET away.
 *
 * Same-origin is the cheapest gate that holds. A browser sends `Referer` on a
 * same-origin fetch and `Origin` on anything cross-origin, so a real page on
 * this host always presents at least one of them; curl, yt-dlp, VLC and a
 * scraper's script present neither. We fail closed when both are missing.
 *
 * Deliberately narrow: only the playback-minting actions are gated. `status`,
 * `catalog`, `categories` and `epg` are metadata, and gating them would break
 * operator curls and the diagnostics for no security gain — nothing there
 * plays.
 */
function sameOriginOk(request, url) {
  const host = url.host.toLowerCase();
  const hostOf = (value) => {
    try {
      return new URL(String(value)).host.toLowerCase();
    } catch {
      return "";
    }
  };

  const origin = request.headers.get("Origin");
  if (origin) return hostOf(origin) === host;

  const referer = request.headers.get("Referer");
  if (referer) return hostOf(referer) === host;

  return false;
}

function forbiddenResponse() {
  return {
    body: {
      ok: false,
      error: "same-origin request required",
      isolated: true,
      source: "IPTV_LAB_JSON",
    },
    status: 403,
  };
}

export const iptvLabRoute = {
  name: "iptv-lab",
  methods: ["GET", "HEAD", "OPTIONS"],
  test: (url) => API_RE.test(url.pathname),
  async handle({ request, env, url, method }) {
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
    if (MINTS_PLAYBACK.has(action) && !sameOriginOk(request, url)) {
      return jsonResponse(forbiddenResponse().body, {
        status: 403,
        cacheSeconds: 0,
        proxyTag: "iptv-lab",
      });
    }

    const result =
      action === "status"
        ? await getIptvLabStatus(env, url.searchParams)
        : action === "categories"
          ? await getIptvLabCategories(env, url.searchParams)
          : action === "catalog"
            ? await getIptvLabCatalog(env)
            : action === "channel"
              ? await getIptvLabChannel(env, url.searchParams)
              : action === "epg"
                ? await getIptvLabEpg(env)
                : action === "probe"
                  ? await probeIptvLabChannel(env, url.searchParams)
                  : await getIptvLabLive(env, url.searchParams);

    return jsonResponse(result.body, {
      status: result.status,
      // The catalogue is a ~1.7MB provider pull, and iptv-auto.js re-fetches it
      // every 45s from every open tab — 1,030 requests in six hours, each one a
      // fresh get_live_streams against the line. It is metadata that changes a
      // few times a day, so an edge cache costs nothing and takes that load off
      // the provider. Never cache `live`/`channel`: those mint signed URLs whose
      // TTL is the whole point.
      cacheSeconds: action === "epg" ? 20 : action === "catalog" || action === "categories" ? 120 : 0,
      proxyTag: "iptv-lab",
    });
  },
};
