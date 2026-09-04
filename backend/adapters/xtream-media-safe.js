import {
  isHttpRedirectStatus,
  rewriteXtreamRedirect,
  shouldRetryXtreamMediaWithoutRange,
  xtreamMediaHeaders,
} from "../../lib/xtream-client.js";
import { createMediaToken, decodeMediaToken } from "./xtream.js";

const MANIFEST_SNIFF_BYTES = 64;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const textDecoder = new TextDecoder();

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

async function followXtreamRedirect(url, buildInit) {
  const first = await fetch(url, buildInit());
  const location = first.headers.get("Location");
  if (!isHttpRedirectStatus(first.status) || !location) return first;
  const followUrl = rewriteXtreamRedirect(url, location);
  return followUrl ? fetch(followUrl, buildInit()) : first;
}

async function fetchXtreamTarget(target, request, { includeRange = true } = {}) {
  const method = request.method === "HEAD" ? "HEAD" : "GET";
  return followXtreamRedirect(target, () => ({
    method,
    headers: xtreamMediaHeaders(request, { includeRange }),
    redirect: "manual",
  }));
}

async function fetchXtreamMedia(target, request) {
  const ranged = await fetchXtreamTarget(target, request, { includeRange: true });
  if (
    request.method !== "HEAD" &&
    !ranged.ok &&
    shouldRetryXtreamMediaWithoutRange(ranged.status, Boolean(request.headers.get("Range")))
  ) {
    const retry = await fetchXtreamTarget(target, request, { includeRange: false });
    if (retry.ok) return retry;
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

async function sniffBody(response) {
  if (!response.body) return { kind: "stream", body: null };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let done = false;

  while (!done && total < MANIFEST_SNIFF_BYTES) {
    const next = await reader.read();
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
              const next = await reader.read();
              if (next.done) {
                controller.close();
                return;
              }
              if (next.value?.byteLength) controller.enqueue(next.value);
            }
          } catch (error) {
            controller.error(error);
          }
        };
        void pump();
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return { kind: "stream", body };
  }

  while (!done) {
    const next = await reader.read();
    done = next.done;
    if (!next.value?.byteLength) continue;
    total += next.value.byteLength;
    if (total > MAX_MANIFEST_BYTES) {
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
 */
export async function proxyXtreamMediaSafe(request, env, token) {
  const target = await decodeMediaToken(env, token);
  const response = await fetchXtreamMedia(target, request);
  if (!response.ok) {
    const status = safeHttpStatus(response.status, 502);
    return new Response(request.method === "HEAD" ? null : `Upstream error ${status}`, {
      status,
      headers: mediaHeaders(response),
    });
  }

  if (request.method === "HEAD") {
    return new Response(null, {
      status: safeHttpStatus(response.status, 200),
      headers: mediaHeaders(response, {
        "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
      }),
    });
  }

  const sniffed = await sniffBody(response);
  if (sniffed.kind === "manifest") {
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
