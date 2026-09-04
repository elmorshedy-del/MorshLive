#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT || 8080);
const KORAZERO_ORIGIN = String(process.env.KORAZERO_ORIGIN || "https://korazero.com").replace(/\/$/, "");
const ROOT = process.env.HLS_ROOT || path.join(os.tmpdir(), "korazero-hls");
const IDLE_MS = Number(process.env.HLS_IDLE_MS || 90_000);
const READY_SEGMENTS = Number(process.env.HLS_READY_SEGMENTS || 3);
const READY_TIMEOUT_MS = Number(process.env.HLS_READY_TIMEOUT_MS || 18_000);
const sessions = new Map();

await fsp.mkdir(ROOT, { recursive: true });

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function keyFor(portal, stream) {
  return `${safeId(portal)}__${safeId(stream)}`;
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
}

function json(res, status, body) {
  cors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function fetchJson(url, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      throw new Error(body?.error || `HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveUpstream(portal, stream) {
  const query = new URLSearchParams({ portal, stream, limit: "1", direct: "1" });
  const live = await fetchJson(`${KORAZERO_ORIGIN}/api/xtream/live?${query}`);
  const channel = (live.portals || []).flatMap((block) => block.streams || [])[0];
  if (!channel) throw new Error("Selected channel is not available");
  const relative = channel.directTsPlaybackUrl || channel.tsPlaybackUrl || channel.directPlaybackUrl || channel.playbackUrl;
  if (!relative) throw new Error("Selected channel has no playable upstream URL");
  const url = new URL(relative, KORAZERO_ORIGIN).toString();
  return { url, channel };
}

function playlistSegmentCount(text) {
  return (String(text || "").match(/^#EXTINF:/gm) || []).length;
}

async function readPlaylist(session) {
  try {
    return await fsp.readFile(session.playlist, "utf8");
  } catch {
    return "";
  }
}

async function waitUntilReady(session) {
  const started = Date.now();
  while (Date.now() - started < READY_TIMEOUT_MS) {
    if (session.lastError) throw session.lastError;
    const text = await readPlaylist(session);
    if (playlistSegmentCount(text) >= READY_SEGMENTS) return text;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Stream did not build a stable HLS buffer in time");
}

function ffmpegArgs(upstream, session) {
  return [
    "-hide_banner",
    "-loglevel", "warning",
    "-nostdin",
    "-rw_timeout", "15000000",
    "-reconnect", "1",
    "-reconnect_at_eof", "1",
    "-reconnect_streamed", "1",
    "-reconnect_on_network_error", "1",
    "-reconnect_on_http_error", "4xx,5xx",
    "-reconnect_delay_max", "2",
    "-reconnect_max_retries", "12",
    "-fflags", "+genpts+discardcorrupt",
    "-i", upstream,
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    "-c", "copy",
    "-avoid_negative_ts", "make_zero",
    "-max_muxing_queue_size", "2048",
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "8",
    "-hls_delete_threshold", "4",
    "-hls_start_number_source", "epoch",
    "-hls_flags", "delete_segments+program_date_time+temp_file+independent_segments+omit_endlist",
    "-hls_segment_filename", path.join(session.dir, "seg_%012d.ts"),
    session.playlist,
  ];
}

async function spawnRelay(session) {
  session.lastError = null;
  session.starting = true;
  const { url, channel } = await resolveUpstream(session.portal, session.stream);
  session.channel = channel;
  session.upstream = url;
  await fsp.mkdir(session.dir, { recursive: true });

  const child = spawn("ffmpeg", ffmpegArgs(url, session), {
    stdio: ["ignore", "ignore", "pipe"],
  });
  session.proc = child;
  session.generation += 1;
  const generation = session.generation;
  let stderr = "";

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-8000);
  });

  child.once("error", (error) => {
    if (generation !== session.generation) return;
    session.lastError = error;
    session.starting = false;
  });

  child.once("exit", (code, signal) => {
    if (generation !== session.generation) return;
    session.proc = null;
    session.starting = false;
    if (session.stopping) return;
    const detail = stderr.trim().split("\n").slice(-4).join(" | ");
    console.warn(`[relay] ffmpeg exited ${session.key} code=${code} signal=${signal || ""} ${detail}`);
    session.restartTimer = setTimeout(() => {
      session.restartTimer = null;
      if (session.stopping || Date.now() - session.lastAccess > IDLE_MS) return;
      spawnRelay(session).catch((error) => {
        session.lastError = error;
        console.error(`[relay] restart failed ${session.key}: ${error.message}`);
      });
    }, 1200);
  });

  try {
    await waitUntilReady(session);
    session.starting = false;
    console.log(`[relay] ready ${session.key} ${channel?.name || ""}`);
  } catch (error) {
    session.starting = false;
    session.lastError = error;
    try { child.kill("SIGTERM"); } catch {}
    throw error;
  }
}

async function ensureSession(portal, stream) {
  const key = keyFor(portal, stream);
  let session = sessions.get(key);
  if (!session) {
    const dir = path.join(ROOT, key);
    session = {
      key,
      portal,
      stream,
      dir,
      playlist: path.join(dir, "index.m3u8"),
      proc: null,
      starting: false,
      startPromise: null,
      lastError: null,
      lastAccess: Date.now(),
      generation: 0,
      restartTimer: null,
      stopping: false,
      channel: null,
      upstream: null,
    };
    sessions.set(key, session);
  }
  session.lastAccess = Date.now();
  session.stopping = false;

  const playlist = await readPlaylist(session);
  if (session.proc && playlistSegmentCount(playlist) >= READY_SEGMENTS) return session;

  if (!session.startPromise) {
    session.startPromise = spawnRelay(session)
      .finally(() => {
        session.startPromise = null;
      });
  }
  await session.startPromise;
  return session;
}

function stopSession(session) {
  session.stopping = true;
  session.generation += 1;
  if (session.restartTimer) clearTimeout(session.restartTimer);
  session.restartTimer = null;
  if (session.proc) {
    try { session.proc.kill("SIGTERM"); } catch {}
    session.proc = null;
  }
  sessions.delete(session.key);
  fsp.rm(session.dir, { recursive: true, force: true }).catch(() => {});
}

setInterval(() => {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (now - session.lastAccess > IDLE_MS) stopSession(session);
  }
}, 30_000).unref();

async function serveFile(res, file, type, cacheControl) {
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return false;
    cors(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Cache-Control", cacheControl);
    fs.createReadStream(file).pipe(res);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      cors(res);
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/__health") {
      json(res, 200, { ok: true, sessions: sessions.size, ffmpeg: true });
      return;
    }

    const match = url.pathname.match(/^\/hls\/([a-zA-Z0-9_-]+)\/([0-9]+)\/(index\.m3u8|seg_[0-9]+\.ts)$/);
    if (!match) {
      json(res, 404, { ok: false, error: "not found" });
      return;
    }

    const [, portal, stream, asset] = match;
    const session = await ensureSession(portal, stream);
    session.lastAccess = Date.now();
    const file = path.join(session.dir, asset);

    if (asset === "index.m3u8") {
      const ok = await serveFile(res, file, "application/vnd.apple.mpegurl", "no-store, max-age=0");
      if (!ok) json(res, 503, { ok: false, error: "playlist is preparing" });
      return;
    }

    const ok = await serveFile(res, file, "video/mp2t", "public, max-age=60, immutable");
    if (!ok) json(res, 404, { ok: false, error: "segment expired" });
  } catch (error) {
    console.error(`[relay] request failed: ${error.stack || error.message}`);
    json(res, 503, { ok: false, error: error.message || "relay unavailable" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[relay] listening on ${PORT}; origin=${KORAZERO_ORIGIN}; root=${ROOT}`);
});

function shutdown() {
  for (const session of sessions.values()) stopSession(session);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
