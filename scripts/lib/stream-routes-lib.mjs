/**
 * Shared stream-route persistence — crawled embed chains for worker + prekickoff heal.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const STREAM_ROUTES_JSON = path.join(ROOT, "assets", "data", "stream-routes.json");
export const STREAM_ROUTES_JS = path.join(ROOT, "assets", "js", "stream-routes.js");

export const DEFAULT_ROUTES = {
  version: 1,
  updatedAt: null,
  slots: {
    ntv: {
      embedUrl:
        "https://ntv.cx/embed?t=OFd0cFZIcCtUQ3NleURxSUs1SW9VQW81eDZjTHdaUjNGL0RxZWZUU24zVTNIQlVsbEpqTkgzbkk3TmhiRGJwMw~~",
      wrapperUrl: null,
      chain: [],
    },
    sirTv: {
      player: "https://we.shootsync.site/albaplayer/sniaer/",
      referer: "https://s.sirtv.space/2026/02/ch1.html?m=1",
    },
    kooraCity: {
      defaultCard: "https://s.yalashot.online/2026/06/ch1.html",
      wrapperUrl: null,
    },
    amine: {
      base: "https://yallashooot.tv/albaplayer/amine/",
      defaultServ: 0,
    },
  },
  byMatch: {},
};

export function loadStreamRoutes() {
  try {
    const raw = JSON.parse(fs.readFileSync(STREAM_ROUTES_JSON, "utf8"));
    return {
      ...DEFAULT_ROUTES,
      ...raw,
      slots: { ...DEFAULT_ROUTES.slots, ...(raw.slots || {}) },
      byMatch: { ...(raw.byMatch || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_ROUTES);
  }
}

export function saveStreamRoutes(doc) {
  const out = {
    ...doc,
    version: doc.version || 1,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(STREAM_ROUTES_JSON), { recursive: true });
  fs.writeFileSync(STREAM_ROUTES_JSON, `${JSON.stringify(out, null, 2)}\n`);
  fs.writeFileSync(
    STREAM_ROUTES_JS,
    `/* Auto-synced from assets/data/stream-routes.json by prekickoff-heal */\n` +
      `window.KZ_STREAM_ROUTES = ${JSON.stringify(out, null, 2)};\n`
  );
  return out;
}

export function matchRouteKey(home, away) {
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  return [norm(home), norm(away)].filter(Boolean).sort().join("~");
}
