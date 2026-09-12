import {
  followXtreamRedirectChain,
  shouldRetryXtreamMediaWithoutRange,
  xtreamMediaHeaders,
} from "../../lib/xtream-client.js";
import { createMediaToken, decodeMediaToken } from "./xtream.js";

const MANIFEST_SNIFF_BYTES = 64;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUTS = Object.freeze({
  headers: 8_000,
  sniff: 8_000,
  pump: 15_000,
});
const textDecoder = new TextDecoder();

class UpstreamIdleError extends Error {
  constructor(stage, ms) {
    super(`Xtream upstream idle during ${stage} for ${ms}ms`);
    this.name = "UpstreamIdleError";
  }
}

function resolveTimeouts(overrides = {}) {
  const positive = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    headers: positive(overrides.headers, DEFAULT_TIMEOUTS.headers),
    sniff: positive(overrides.sniff, DEFAULT_TIMEOUTS.sniff),
    pump: positive(overrides.pump, DEFAULT_TIMEOUTS.pump),
  };
}

function abortUpstream(controller, reason) {
  if (!controller || controller.signal.aborted) return;
  try {
    controller.abort(reason);
  } catch {}
}

function timeoutError(stage, ms) {
  return new UpstreamIdleError(stage, ms);
}

async function readOrTimeout(reader, ms, upstreamController, stage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = timeoutError(stage, ms);
      // Reject first so callers consistently see the idle error, then abort the
      // underlying fetch so the provider's single connection slot is released.
      reject(error);
      abortUpstream(upstreamController, error);
    }, ms);
  });

  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function mediaHeaders(response, extra = {}) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "X-KZ-Proxy": "xtream-media",
    ...extra,
  };
  for (const name of ["Content-Range", "Accept-Ranges"]) {
    const value = response?.headers?.get?.(name);
    if (value) headers[name] = value;
  }
  return headers;
}

function safeHttpStatus(status, fallback = 502) {
  const code = Number(status);
  return Number.isInteger(code) && code >= 200 && code <= 599 ? code : fallback;
}

function upstreamTimeoutResponse(request) {
  return new Response(request.method === "HEAD" ? null : "Upstream timed out", {
    status: 504,
    headers: mediaHeaders(null),
  });
}

async function fetchXtreamTarget(target, request, timeouts, { includeRange = true } = {}) {
  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const upstreamController = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = timeoutError("response headers", timeouts.headers);
      reject(error);
      abortUpstream(upstreamController, error);
    }, timeouts.headers);
  });

  try {
    const response = await Promise.race([
      followXtreamRedirectChain(target, () => ({
        method,
        headers: xtreamMediaHeaders(request, { includeRange }),
        redirect: "manual",
        signal: upstreamController.signal,
      })),
      timeout,
    ]);
    return { response, upstreamController };
  } catch (error) {
    abortUpstream(upstreamController, error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchXtreamMedia(target, request, timeouts) {
  const ranged = await fetchXtreamTarget(target, request, timeouts, { includeRange: true });
  if (
    request.method !== "HEAD" &&
    !ranged.response.ok &&
    shouldRetryXtreamMediaWithoutRange(ranged.response.status, Boolean(request.headers.get("Range")))
  ) {
    // Do not leave the first response holding the provider slot while retrying.
    abortUpstream(ranged.upstreamController, "retry without Range");
    const retry = await fetchXtreamTarget(target, request, timeouts, { includeRange: false });
    if (retry.response.ok) return retry;
    abortUpstream(retry.upstreamController, "range retry rejected");
  }
  return ranged;
}

async function replaceAsync(value, expression, replacer) {
  const matches = [...value.matchAll(expression)];
  if (!matches.length) return value;
  const replacements = await Promise.all(matches.map((match) => replacer(match)));
  let output = "";
  let cursor = 0;
  matches.forEach((match, index) => {
    output += value.slice(cursor, match.index) + replacements[index];
    cursor = match.index + match[0].length;
  });
  return output + value.slice(cursor);
}

async function rewriteManifest(text, manifestUrl, env) {
  const proxyUrl = async (raw) => {
    const target = new URL(raw, manifestUrl).toString();
    const token = await createMediaToken(env, target);
    return `/api/xtream/media/${token}`;
  };

  const lines = await Promise.all(
    String(text || "")
      .split(/\r?\n/)
      .map(async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (!trimmed.startsWith("#")) return proxyUrl(trimmed);
        return replaceAsync(line, /URI=("([^"]+)"|'([^']+)')/g, async (match) => {
          const quote = match[1][0];
          const raw = match[2] || match[3] || "";
          return `URI=${quote}${await proxyUrl(raw)}${quote}`;
        });
      }),
  );
  return lines.join("\n");
}

function concatChunks(chunks, total) {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function sniffBody(response, upstreamController, timeouts) {
  if (!response.body) return { kind: "stream", body: null };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let done = false;

  while (!done && total < MANIFEST_SNIFF_BYTES) {
    const next = await readOrTimeout(reader, timeouts.sniff, upstreamController, "payload sniff");
    done = next.done;
    if (next.value?.byteLength) {
      chunks.push(next.value);
      total += next.value.byteLength;
    }
  }

  const prefix = concatChunks(chunks, total);
  const looksLikeManifest = textDecoder
    .decode(prefix)
    .replace(/^\uFEFF/, "")
    .trimStart()
    .startsWith("#EXTM3U");

  if (!looksLikeManifest) {
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        if (done) {
          controller.close();
          return;
        }
        const pump = async () => {
          try {
            while (true) {
              const next = await readOrTimeout(reader, timeouts.pump, upstreamController, "media stream");
              if (next.done) {
                controller.close();
                return;
              }
              if (next.value?.byteLength) controller.enqueue(next.value);
            }
          } catch (error) {
            abortUpstream(upstreamController, error);
            controller.error(error);
          }
        };
        void pump();
      },
      cancel(reason) {
        abortUpstream(upstreamController, reason || "downstream cancelled");
        return reader.cancel(reason);
      },
    });
    return { kind: "stream", body };
  }

  while (!done) {
    const next = await readOrTimeout(reader, timeouts.sniff, upstreamController, "manifest body");
    done = next.done;
    if (!next.value?.byteLength) continue;
    total += next.value.byteLength;
    if (total > MAX_MANIFEST_BYTES) {
      abortUpstream(upstreamController, "manifest too large");
      try {
        await reader.cancel("manifest too large");
      } catch {}
      throw new Error("HLS manifest exceeded safe size");
    }
    chunks.push(next.value);
  }
  return { kind: "manifest", text: textDecoder.decode(concatChunks(chunks, total)) };
}

/**
 * Proxy Xtream media without trusting a `.m3u8` suffix.
 * Some providers return an endless MPEG-TS byte stream from their nominal
 * `.m3u8` endpoint. Calling response.text() on that stream can buffer forever.
 * We sniff a small prefix: only a real #EXTM3U body is buffered and rewritten;
 * every other payload is streamed through immediately.
 *
 * Every upstream wait is bounded. On header/sniff/manifest timeout we return
 * 504 before a response is committed. Once streaming has started, an idle pump
 * errors the downstream body. Both paths abort the actual upstream fetch so a
 * silent provider cannot pin the account's single connection slot indefinitely.
 */
export async function proxyXtreamMediaSafe(request, env, token, timeoutOverrides) {
  const target = await decodeMediaToken(env, token);
  const timeouts = resolveTimeouts(timeoutOverrides);
  let upstream;
  try {
    upstream = await fetchXtreamMedia(target, request, timeouts);
  } catch (error) {
    if (error instanceof UpstreamIdleError) return upstreamTimeoutResponse(request);
    throw error;
  }

  const { response, upstreamController } = upstream;
  if (!response.ok) {
    const status = safeHttpStatus(response.status, 502);
    abortUpstream(upstreamController, `upstream HTTP ${status}`);
    return new Response(request.method === "HEAD" ? null : `Upstream error ${status}`, {
      status,
      headers: mediaHeaders(response),
    });
  }

  if (request.method === "HEAD") {
    abortUpstream(upstreamController, "HEAD complete");
    return new Response(null, {
      status: safeHttpStatus(response.status, 200),
      headers: mediaHeaders(response, {
        "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
      }),
    });
  }

  let sniffed;
  try {
    sniffed = await sniffBody(response, upstreamController, timeouts);
  } catch (error) {
    abortUpstream(upstreamController, error);
    if (error instanceof UpstreamIdleError) return upstreamTimeoutResponse(request);
    throw error;
  }

  if (sniffed.kind === "manifest") {
    abortUpstream(upstreamController, "manifest complete");
    const rewritten = await rewriteManifest(sniffed.text, target, env);
    return new Response(rewritten, {
      status: 200,
      headers: mediaHeaders(response, { "Content-Type": "application/vnd.apple.mpegurl" }),
    });
  }

  return new Response(sniffed.body, {
    status: safeHttpStatus(response.status, 200),
    headers: mediaHeaders(response, {
      "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
    }),
  });
}
