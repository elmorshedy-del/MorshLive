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
  // Pull straight from production. The harness exists so a *browser* can reach
  // the site through a TLS-terminating sandbox proxy; Node has no such problem,
  // and the extra hop would only add its own buffering to the measurement.
  const url = MEDIA_RE.test(tsUrl) ? "https://korazero.com" + tsUrl : tsUrl;
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
      // Belt and braces: abort signals on a stalled live stream have been known
      // not to fire promptly, and a diagnostic must never outstay its welcome
      // on a one-slot line.
      if (now - started > (seconds + 5) * 1000) {
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
    gaps: gaps.slice(0, 12),
    perSecondMbps: rates.map(mbps),
  };
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
  const rhythm = gapRhythm(r.gaps);
  if (rhythm) lines.push(`  gap rhythm         : ${rhythm}`);
  const verdict = r.stallCount === 0 && r.minMbps > 0.5 ? "STEADY" : r.stallCount ? "GAPPY — this feed stalls" : "THIN";
  lines.push(`  verdict            : ${verdict}`);
  return lines.join("\n");
}
