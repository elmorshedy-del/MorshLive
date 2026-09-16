/**
 * KoraZero Diagnostics — transport probe.
 *
 * Measures whether a feed *delivers bytes steadily*, with no browser and no
 * decoder involved. That matters for two reasons:
 *
 *  1. A "drain" is a buffer emptying faster than it fills. Whether the bytes
 *     arrive fast enough and without gaps is the question, and it is separable
 *     from whether a particular browser can decode them.
 *  2. Headless Chromium is commonly built without H.264/AAC, so the browser
 *     driver cannot play a real TS stream in every environment. This can.
 *
 * It answers: how long to the first byte, what sustained rate, and — the one
 * that matters — were there gaps where nothing arrived.
 */

const MEDIA_RE = /\/api\/xtream\/media\//;

/** Ask the site to resolve and sign a playable URL. Minting is not playback. */
export async function resolvePlayable({ origin, channel, portal, stream }) {
  const url = channel
    ? `${origin}/api/iptv-lab/channel?id=${encodeURIComponent(channel)}`
    : `${origin}/api/iptv-lab/live?portal=${encodeURIComponent(portal || "p1")}&stream=${encodeURIComponent(stream)}&limit=1`;

  const res = await fetch(url, { headers: { referer: `${origin}/watch.html` } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new Error(`resolve failed (${res.status}): ${body?.error || "no body"}`);
  }

  if (channel) {
    return {
      tsUrl: body.tsPlaybackUrl,
      streamId: body.streamId,
      name: body.name,
      alternates: body.alternates || [],
    };
  }
  const row = (body.portals || []).flatMap((p) => p.streams || [])[0];
  if (!row?.tsPlaybackUrl) throw new Error("resolve returned no playable stream");
  return { tsUrl: row.tsPlaybackUrl, streamId: stream, name: row.name || null, alternates: [] };
}

/**
 * Pull the stream for `seconds` and record delivery second by second.
 * `gapMs` is the longest interval in which no bytes arrived at all — the
 * transport-level equivalent of a rebuffer.
 */
export async function measureTransport({ origin, tsUrl, seconds = 30, stallMs = 1500 }) {
  const url = MEDIA_RE.test(tsUrl) ? origin + tsUrl : tsUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), seconds * 1000);

  const started = Date.now();
  let firstByteAt = null;
  let total = 0;
  let lastChunkAt = started;
  let longestGapMs = 0;
  const gaps = [];
  const perSecond = new Map();
  let status = null;
  let error = null;

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { referer: `${origin}/watch.html`, "user-agent": "KoraZeroDiagnostics/1.0" },
    });
    status = res.status;
    if (!res.ok || !res.body) {
      clearTimeout(timer);
      return { status, bytes: 0, error: `upstream ${status}`, seconds: (Date.now() - started) / 1000 };
    }
    for await (const chunk of res.body) {
      const now = Date.now();
      if (firstByteAt === null) firstByteAt = now - started;
      const gap = now - lastChunkAt;
      if (gap > stallMs) {
        gaps.push({ atSec: +((lastChunkAt - started) / 1000).toFixed(1), gapMs: gap });
        longestGapMs = Math.max(longestGapMs, gap);
      }
      lastChunkAt = now;
      total += chunk.length;
      const sec = Math.floor((now - started) / 1000);
      perSecond.set(sec, (perSecond.get(sec) || 0) + chunk.length);
    }
  } catch (e) {
    if (e?.name !== "AbortError") error = String(e?.message || e);
  } finally {
    clearTimeout(timer);
  }

  const elapsed = (Date.now() - started) / 1000;
  const rates = [...perSecond.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
  const mbps = (bytes) => +((bytes * 8) / 1e6).toFixed(2);
  const sorted = rates.slice().sort((a, b) => a - b);

  return {
    status,
    error,
    seconds: +elapsed.toFixed(1),
    ttfbMs: firstByteAt,
    bytes: total,
    megabytes: +(total / 1e6).toFixed(1),
    meanMbps: elapsed ? mbps(total / elapsed) : 0,
    medianMbps: sorted.length ? mbps(sorted[sorted.length >> 1]) : 0,
    minMbps: sorted.length ? mbps(sorted[0]) : 0,
    stallCount: gaps.length,
    longestGapMs,
    gaps: gaps.slice(0, 12),
    perSecondMbps: rates.map(mbps),
  };
}

export function formatTransport(label, r, meta) {
  const lines = [`\n── ${label} ${"─".repeat(Math.max(2, 56 - label.length))}`];
  if (meta) lines.push(`  feed        : ${meta.name ?? "?"}   streamId ${meta.streamId ?? "?"}`);
  if (r.error || r.status !== 200) {
    lines.push(`  RESULT      : FAILED  status ${r.status ?? "-"}  ${r.error ?? ""}`);
    return lines.join("\n");
  }
  lines.push(`  time to first byte : ${r.ttfbMs} ms`);
  lines.push(`  delivered          : ${r.megabytes} MB in ${r.seconds}s`);
  lines.push(`  rate               : mean ${r.meanMbps} Mbps   median ${r.medianMbps}   min ${r.minMbps}`);
  lines.push(`  stalls (>1.5s idle): ${r.stallCount}${r.stallCount ? `   longest ${r.longestGapMs} ms` : ""}`);
  if (r.gaps.length) lines.push(`  gap detail         : ${JSON.stringify(r.gaps)}`);
  const verdict = r.stallCount === 0 && r.minMbps > 0.5 ? "STEADY" : r.stallCount ? "GAPPY — this feed stalls" : "THIN";
  lines.push(`  verdict            : ${verdict}`);
  return lines.join("\n");
}
