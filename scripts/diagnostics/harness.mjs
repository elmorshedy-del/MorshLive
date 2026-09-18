/**
 * KoraZero Diagnostics — the harness origin.
 *
 * Serves the repository's own files and proxies every /api/* call through to
 * production. Node is used for the proxy hop on purpose: in a sandboxed agent
 * environment outbound TLS is re-terminated by a proxy whose CA headless
 * Chromium will not trust, so the browser can never talk to korazero.com
 * directly. Node does trust it. The browser therefore talks plain HTTP to
 * 127.0.0.1 and this process does the real fetch.
 *
 * The media policy is the safety interlock. The provider line permits ONE
 * concurrent stream, so a diagnostic that opens a stream takes it away from a
 * real viewer. Media is refused unless a run explicitly asks for it.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = "https://korazero.com";

/**
 * Paths that reach the provider and can consume the line's single slot.
 *
 * `/api/iptv-lab/probe` belongs here and was missing: it reaches `probeMediaUrl`
 * (backend/adapters/xtream.js), which fetches a real manifest, a real segment
 * and a real TS body. Both `iptv-quality.js` and `iptv-lab-compat-fallback.js`
 * fire it on `kz:iptv-playback-failed`, so a run WITHOUT --live could still take
 * the slot from a viewer the moment a page reported a playback failure — which
 * is exactly when a diagnostic is most likely to be running.
 *
 * `/api/iptv-lab/status` is deliberately NOT here: it only probes channels when
 * `media=1` is passed, so the plain status call is free. `?media=1` is not.
 */
const SLOT_CONSUMING = [
  /^\/api\/xtream\/media/,
  /^\/api\/xtream\/direct/,
  /^\/wk\/hls/,
  /^\/api\/iptv-lab\/probe/,
];

/** Free to call, except in the one shape that reaches the provider. */
export function consumesSlot(pathname, search) {
  if (SLOT_CONSUMING.some((re) => re.test(pathname))) return true;
  return /^\/api\/iptv-lab\/status/.test(pathname) && /(^|&)media=1(&|$)/.test(search.replace(/^\?/, ""));
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * `_redirects` is what turns /watch.html?… and the pretty URLs into files. We
 * only need the plain-file rules, so a shallow reader is enough here.
 */
function readRewrites() {
  const rules = [];
  try {
    for (const line of fs.readFileSync(path.join(ROOT, "_redirects"), "utf8").split("\n")) {
      const m = /^(\S+)\s+(\S+)\s+200\s*$/.exec(line.trim());
      if (m && !m[1].includes(":")) rules.push([m[1], m[2]]);
    }
  } catch {
    /* a missing _redirects just means no pretty URLs in this run */
  }
  return new Map(rules);
}

export function startHarness({ allowMedia = false, port = 0 } = {}) {
  const rewrites = readRewrites();
  /** Every request the page made, with timing and outcome. */
  const records = [];
  const refused = [];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://harness");
    const started = Date.now();
    let servedPath = url.pathname;

    const note = (kind, status, bytes) => {
      records.push({
        t: started,
        ms: Date.now() - started,
        kind,
        status,
        bytes,
        path: url.pathname,
        query: url.search,
      });
    };

    if (!allowMedia && consumesSlot(url.pathname, url.search)) {
      refused.push(url.pathname);
      note("refused", 503, 0);
      res.writeHead(503, { "content-type": "text/plain" });
      return res.end("korazero-diagnostics: media refused (run without --live)");
    }

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/wk/")) {
      try {
        const upstream = await fetch(ORIGIN + req.url, {
          headers: { referer: `${ORIGIN}/watch.html`, "user-agent": req.headers["user-agent"] || "" },
        });
        res.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") || "application/json",
          "cache-control": "no-store",
        });
        // Stream rather than buffer. A live TS feed never ends, so reading it
        // into memory first would hang here forever and look like the site
        // failing to respond.
        if (!upstream.body) {
          note("api", upstream.status, 0);
          return res.end();
        }
        let streamed = 0;
        for await (const chunk of upstream.body) {
          streamed += chunk.length;
          if (!res.write(Buffer.from(chunk))) {
            await new Promise((drain) => res.once("drain", drain));
          }
        }
        note("api", upstream.status, streamed);
        return res.end();
      } catch (error) {
        note("api-error", 502, 0);
        res.writeHead(502, { "content-type": "text/plain" });
        return res.end(String(error?.message || error));
      }
    }

    // Pretty URL → file, then fall back to the path itself.
    const rewritten = rewrites.get(url.pathname);
    if (rewritten) servedPath = rewritten.split("?")[0];
    const candidate = path.join(ROOT, servedPath === "/" ? "index.html" : decodeURIComponent(servedPath));

    if (candidate.startsWith(ROOT) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const body = fs.readFileSync(candidate);
      note("static", 200, body.length);
      res.writeHead(200, {
        "content-type": TYPES[path.extname(candidate)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      return res.end(body);
    }

    note("static", 404, 0);
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        origin: `http://127.0.0.1:${server.address().port}`,
        records,
        refused,
        allowMedia,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
