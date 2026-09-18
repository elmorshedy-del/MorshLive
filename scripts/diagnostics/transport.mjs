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

import fs from "node:fs";

import { MediaClock, classifyDelivery } from "./ts-analysis.mjs";

const MEDIA_RE = /\/api\/xtream\/media\//;

/**
 * SUPERSEDED 2026-09-18 — retained for the record and for its tests, and used
 * in NO verdict. It consumes at the feed's own mean delivered rate, which makes
 * it circular: it measures deviation from the feed's own trend and is
 * structurally blind to sustained under-delivery. It is also dominated by the
 * startup transient — every feed measured on 2026-09-17 reported its worst
 * shortfall at 0.2-0.3 s, because once an opening burst banks a surplus no
 * later gap can register. Use `MediaClock` in ts-analysis.mjs instead.
 *
 * How much prebuffer would a player have needed to never run dry?
 *
 * This replaces counting quiet seconds, which was actively misleading. This
 * transport does not trickle bytes at the playback rate — it flushes roughly
 * 256 KiB chunks on a ~2 s cycle, so a perfectly healthy feed spends whole
 * seconds delivering nothing and then catches up in a burst. Counting those
 * quiet windows as "stalls" rated bursty-but-fine feeds as broken and produced
 * a confident, wrong diagnosis (gaps identical at ~2000 ms across unrelated
 * broadcasters were the flush interval, not dropped segments).
 *
 * The honest question is the one the player faces: draining the buffer at the
 * stream's own bitrate, did what arrived ever fall behind what was consumed?
 * Model a leaky bucket over the real arrival times and find the deepest
 * shortfall. That shortfall, in seconds of video, is the prebuffer required to
 * play without a visible stall — directly comparable between feeds, and
 * directly comparable to what the player is configured to hold.
 *
 * Returns null when there is too little data to model.
 */
export function bufferFloorSeconds(arrivals, meanBytesPerSec) {
  if (!Array.isArray(arrivals) || arrivals.length < 8 || !(meanBytesPerSec > 0)) return null;

  // Consume at the feed's own average rate: over a long pull that is by
  // definition the rate the content plays at.
  //
  // Each arrival is scored against what was in hand *before* it landed. That
  // instant — the tick before a delayed chunk arrives — is when the buffer is
  // emptiest, and scoring against the post-arrival total instead reported zero
  // shortfall for a feed that had just been silent for four seconds.
  let deepest = 0;
  let deepestAtMs = 0;
  let held = 0;
  for (const [ms, cumulative] of arrivals) {
    const consumed = (ms / 1000) * meanBytesPerSec;
    const shortfall = consumed - held;
    if (shortfall > deepest) {
      deepest = shortfall;
      deepestAtMs = ms;
    }
    held = cumulative;
  }

  return {
    seconds: +(deepest / meanBytesPerSec).toFixed(2),
    bytes: Math.round(deepest),
    atSec: +(deepestAtMs / 1000).toFixed(1),
  };
}

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
export async function measureTransport({ origin, tsUrl, seconds = 30, stallMs = 1500, rawPath = null }) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`measureTransport: seconds must be a positive number, got ${JSON.stringify(seconds)}`);
  }
  // Pull straight from production. The harness exists so a *browser* can reach
  // the site through a TLS-terminating sandbox proxy; Node has no such problem,
  // and the extra hop would only add its own buffering to the measurement.
  const url = MEDIA_RE.test(tsUrl) ? "https://korazero.com" + tsUrl : tsUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    abortedByUs = true;
    controller.abort();
  }, seconds * 1000);

  const started = Date.now();
  let firstByteAt = null;
  let total = 0;
  let lastChunkAt = started;
  let longestGapMs = 0;
  const gaps = [];
  const perSecond = new Map();
  /** (ms since first byte, cumulative bytes) — kept in full, never truncated. */
  const arrivals = [];
  /** Every chunk length, so batching can be re-derived offline. */
  const chunkSizes = [];
  const clock = new MediaClock();
  const rawSink = rawPath ? fs.createWriteStream(rawPath) : null;
  let status = null;
  let error = null;
  /** Did the body end on its own, before we asked it to stop? */
  let upstreamClosed = false;
  let abortedByUs = false;

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { referer: `${origin}/watch.html`, "user-agent": "KoraZeroDiagnostics/1.0" },
    });
    status = res.status;
    if (!res.ok || !res.body) {
      clearTimeout(timer);
      rawSink?.end();
      return {
        status,
        bytes: 0,
        error: `upstream ${status}`,
        requestedSeconds: seconds,
        survivedSeconds: +((Date.now() - started) / 1000).toFixed(2),
        earlyClose: true,
        closeReason: `upstream refused with ${status}`,
        seconds: (Date.now() - started) / 1000,
      };
    }
    for await (const chunk of res.body) {
      const now = Date.now();
      // Belt and braces: abort signals on a stalled live stream have been known
      // not to fire promptly, and a diagnostic must never outstay its welcome
      // on a one-slot line.
      if (now - started > (seconds + 5) * 1000) {
        abortedByUs = true;
        controller.abort();
        break;
      }
      if (firstByteAt === null) firstByteAt = now - started;
      const gap = now - lastChunkAt;
      if (gap > stallMs) {
        gaps.push({ atSec: +((lastChunkAt - started) / 1000).toFixed(1), gapMs: gap });
        longestGapMs = Math.max(longestGapMs, gap);
      }
      lastChunkAt = now;
      total += chunk.length;
      const sinceFirstByte = now - started - firstByteAt;
      arrivals.push([sinceFirstByte, total]);
      chunkSizes.push(chunk.length);
      clock.push(chunk, sinceFirstByte);
      rawSink?.write(Buffer.from(chunk));
      const sec = Math.floor((now - started) / 1000);
      perSecond.set(sec, (perSecond.get(sec) || 0) + chunk.length);
    }
    // Falling out of the loop without having aborted means the body ENDED.
    // A live stream does not end. This is the failure the old probe reported as
    // healthy, because it simply computed a mean over a shorter window.
    if (!abortedByUs) upstreamClosed = true;
  } catch (e) {
    if (e?.name !== "AbortError") {
      error = String(e?.message || e);
      upstreamClosed = true;
    }
  } finally {
    clearTimeout(timer);
    rawSink?.end();
  }

  const elapsed = (Date.now() - started) / 1000;
  // A live stream has no end. If the body finished on its own, the pull failed,
  // however clean the bytes that did arrive looked.
  const earlyClose = upstreamClosed && elapsed < seconds * 0.95;
  const closeReason = !earlyClose
    ? null
    : error
      ? `upstream errored after ${elapsed.toFixed(1)}s of ${seconds}s: ${error}`
      : `upstream closed the body after ${elapsed.toFixed(1)}s of ${seconds}s requested`;
  const clockReport = clock.report(Math.round(elapsed * 1000));
  const rates = [...perSecond.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
  const mbps = (bytes) => +((bytes * 8) / 1e6).toFixed(2);
  const sorted = rates.slice().sort((a, b) => a - b);

  // The first and last per-second buckets are partial by construction: bucket 0
  // begins whenever the first byte lands, and the final one is cut short by the
  // abort. They are not measurements of a rate, and taking the minimum over them
  // labelled the healthiest feed measured so far (34 MB in 75s, not one gap)
  // "THIN" on a 0.11 Mbps edge bucket. Judge the sustained rate on whole seconds.
  const interior = rates.length > 2 ? rates.slice(1, -1) : rates;
  const interiorSorted = interior.slice().sort((a, b) => a - b);

  return {
    status,
    error,
    seconds: +elapsed.toFixed(1),
    ttfbMs: firstByteAt,
    bytes: total,
    megabytes: +(total / 1e6).toFixed(1),
    meanMbps: elapsed ? mbps(total / elapsed) : 0,
    medianMbps: sorted.length ? mbps(sorted[sorted.length >> 1]) : 0,
    minMbps: interiorSorted.length ? mbps(interiorSorted[0]) : 0,
    stallCount: gaps.length,
    longestGapMs,
    // Full, never truncated: gapRhythm used to judge a long run on its first
    // twelve gaps while stallCount used all of them, so the two disagreed by
    // construction.
    gaps,
    perSecondMbps: rates.map(mbps),
    /** Complete raw series, so every figure here can be recomputed offline. */
    arrivals,
    chunkSizes,
    chunkBytes: medianChunkSize(arrivals),

    /** Did the body end before we asked it to stop? A live stream must not. */
    requestedSeconds: seconds,
    survivedSeconds: +elapsed.toFixed(2),
    earlyClose,
    closeReason,

    /**
     * THE verdict. Absolute media clock, not the feed's own byte rate.
     * `bufferFloor` below is computed only for continuity with older records
     * and is deliberately used in no verdict — see its docstring.
     */
    clock: clockReport,
    delivery: classifyDelivery(clockReport),
    bufferFloor: bufferFloorSeconds(arrivals, elapsed ? total / elapsed : 0),
    rawPath,
  };
}

/**
 * Typical chunk size. Worth printing because it is what identifies the delivery
 * as flushed rather than streamed: a tight cluster around a round number (256
 * KiB here) means the upstream is batching, and quiet gaps are expected.
 */
function medianChunkSize(arrivals) {
  if (!Array.isArray(arrivals) || arrivals.length < 4) return null;
  const sizes = arrivals.slice(1).map(([, cumulative], i) => cumulative - arrivals[i][1]);
  sizes.sort((a, b) => a - b);
  return sizes[sizes.length >> 1];
}

/**
 * Describe the *shape* of a gap train, keeping two questions apart:
 *
 *   how LONG each gap is — uniform length is the tell. Congestion and loss
 *     produce gaps of whatever length the recovery takes; something that
 *     interrupts for the same duration every time is running to a clock.
 *   how OFTEN they come — this gives the period, but it is the weaker signal,
 *     because a feed can settle into a cadence only after startup.
 *
 * Measured on beIN stream 2449: five gaps every one within 42 ms of 2000 ms —
 * strongly uniform — but spaced 6.0/17.0/16.0/17.1 s, so the cadence only
 * settles after the first pair. An earlier version of this function demanded
 * both at once and therefore reported nothing at all for that train, which is
 * the opposite of useful: the uniform 2000 ms is exactly the finding.
 */
export function gapRhythm(gaps) {
  if (!Array.isArray(gaps) || gaps.length < 3) return null;

  const spreadOf = (xs) => Math.max(...xs) - Math.min(...xs);
  const meanOf = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const medianOf = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];

  const lengths = gaps.map((g) => g.gapMs);
  const periods = gaps.slice(1).map((g, i) => +(g.atSec - gaps[i].atSec).toFixed(1));

  const meanLength = Math.round(meanOf(lengths));
  // Median, not mean: one short interval at startup should move the reported
  // period a little, not halve it.
  const typicalPeriod = +medianOf(periods).toFixed(1);

  // Deliberately loose: the claim is "regular", not "identical".
  const evenLength = spreadOf(lengths) <= Math.max(150, meanLength * 0.15);
  const evenPeriod = spreadOf(periods) <= Math.max(2, typicalPeriod * 0.25);
  if (!evenLength && !evenPeriod) return null;

  const cadence = evenPeriod ? `every ~${typicalPeriod}s` : `every ~${typicalPeriod}s apart from startup`;
  if (!evenLength) return `${cadence}, length varies — periodic, but not a fixed-length interruption`;

  return (
    `${cadence}, each ~${meanLength} ms (spread ${Math.round(spreadOf(lengths))} ms) — ` +
    `UNIFORM LENGTH, so a timer rather than congestion`
  );
}

export function formatTransport(label, r, meta) {
  const lines = [`\n\u2500\u2500 ${label} ${"\u2500".repeat(Math.max(2, 56 - label.length))}`];
  if (meta) lines.push(`  feed        : ${meta.name ?? "?"}   streamId ${meta.streamId ?? "?"}`);

  if (r.error && !r.bytes) {
    lines.push(`  RESULT      : FAILED  status ${r.status ?? "-"}  ${r.error}`);
    return lines.join("\n");
  }
  if (r.status !== 200) {
    lines.push(`  RESULT      : FAILED  status ${r.status ?? "-"}  ${r.closeReason ?? ""}`);
    return lines.join("\n");
  }

  lines.push(`  time to first byte : ${r.ttfbMs} ms`);
  lines.push(`  requested / survived: ${r.requestedSeconds}s / ${r.survivedSeconds}s`);
  if (r.earlyClose) {
    // The failure the previous probe reported as healthy: it simply averaged
    // over the shorter window and printed "EASY".
    lines.push(`  *** EARLY CLOSE    : ${r.closeReason}`);
  }
  lines.push(`  delivered          : ${r.megabytes} MB`);
  lines.push(`  rate               : mean ${r.meanMbps} Mbps   median ${r.medianMbps}   min ${r.minMbps}`);
  if (r.chunkBytes) lines.push(`  chunk size         : ~${(r.chunkBytes / 1024).toFixed(0)} KiB (batched delivery)`);
  lines.push(`  quiet >1.5s        : ${r.stallCount}${r.stallCount ? `   longest ${r.longestGapMs} ms` : ""}  (shape, not health)`);
  const rhythm = gapRhythm(r.gaps);
  if (rhythm) lines.push(`  gap rhythm         : ${rhythm}`);

  const c = r.clock;
  lines.push(`  \u2500\u2500 media clock (absolute) \u2500`);
  if (!c?.ok) {
    lines.push(`  UNAVAILABLE        : ${c?.reason ?? "not analysed"}`);
    lines.push(`  verdict            : ${r.delivery?.verdict ?? "NO MEDIA CLOCK"}`);
    return lines.join("\n");
  }
  lines.push(`  media / wall       : ${c.mediaSeconds}s of media in ${c.wallSeconds}s  =  ${c.mediaPerWall}x real time`);
  lines.push(`  worst deficit      : ${c.maxDeficitSec}s at ${c.maxDeficitAtSec}s    final ${c.finalDeficitSec}s`);
  lines.push(`  longest behind     : ${c.longestBehindSec}s${c.longestBehindFromSec === null ? "" : ` from ${c.longestBehindFromSec}s`}`);
  lines.push(`  repaid the debt    : ${c.recovered ? "yes" : "NO"}`);
  if (c.discontinuities) lines.push(`  PCR discontinuities: ${c.discontinuities}  ${JSON.stringify(c.discontinuityDetail.slice(0, 4))}`);
  if (c.continuityErrors) lines.push(`  continuity errors  : ${c.continuityErrors} (packet loss)`);
  if (c.pidInventory?.length) {
    lines.push(`  PID layout         : ${c.pidInventory.slice(0, 8).map((x) => `${x.hex}:${x.count}`).join(" ")}`);
    lines.push(`                       (encoder fingerprint — the only origin signal the proxy leaves visible)`);
  }

  const verdict = r.earlyClose ? `${r.delivery.verdict} + EARLY CLOSE` : r.delivery.verdict;
  lines.push(`  verdict            : ${verdict}`);
  lines.push(`                       ${r.delivery.detail}`);
  return lines.join("\n");
}
