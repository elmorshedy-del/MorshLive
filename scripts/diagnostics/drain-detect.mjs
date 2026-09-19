/**
 * KoraZero Diagnostics — decide whether a stream was DRAINED.
 *
 * WHY THIS EXISTS. On 2026-09-18 a concurrency test concluded the line enforces
 * no connection limit. It was wrong, and the whole error was in the pass
 * criterion: it scored a stream as served when `status === 200 && bytes > 0`.
 * An evicted stream satisfies both — it returns 200 and delivers roughly two
 * seconds of video before the upstream closes it. The test asked a question a
 * drained stream answers the same way as a healthy one, so it could not fail.
 *
 * This module exists so that never happens again. It states, in code, what a
 * drain looks like and what distinguishes it from the other ways a pull ends.
 *
 * THE SIGNATURE. A drain is a guillotine, not a decline:
 *
 *   healthy delivery ────────────────────────────█  (nothing)
 *                                                ↑ upstream closed the body
 *
 * The stream is at full rate right up to the instant it dies. That is what
 * separates it from starvation, where the rate decays first:
 *
 *   healthy ──────────▁▁▂▁▁▁_____▁________█
 *
 * Both end early. Only the first is an eviction, and telling them apart is the
 * entire job here — "it ended early" alone cannot, because a feed collapsing
 * under its own weight also ends early.
 *
 * WHAT IT REFUSES TO DO. It never reports HEALTHY on thin evidence. A pull too
 * short to contain the evidence returns INCONCLUSIVE, not a pass, because the
 * failure this module was written to prevent was a short test mistaken for a
 * clean result.
 */

/** Below this, a pull has not run long enough for the tail to mean anything. */
const MIN_JUDGEABLE_SECONDS = 8;
/** Window at the end of a stream whose delivery rate decides the verdict. */
const DEFAULT_TAIL_SECONDS = 5;
/** Tail rate as a fraction of baseline, above which delivery was still healthy. */
const DEFAULT_HEALTHY_RATIO = 0.5;
/**
 * How much quieter than its own habit a stream may go before the close and still
 * count as cut rather than faded.
 *
 * There is deliberately no fixed millisecond threshold here. "Normal silence" is
 * a property of the feed: M9 established that healthy delivery is bursty, and
 * feeds differ — one flushes every 2s, another every 4s. A constant cutoff
 * called a real eviction on a slow-flushing feed a fade, which is a FALSE
 * NEGATIVE, the one error this module must not make. The feed's own gap
 * distribution is the only honest baseline.
 */
const DEFAULT_SILENCE_TOLERANCE = 1.5;
/** Floor, so a metronomic feed is not held to an implausibly tight tail. */
const DEFAULT_SILENCE_FLOOR_MS = 1000;

/**
 * Mean Mbps between two offsets, computed from the cumulative arrival series.
 *
 * Deliberately NOT from `perSecondMbps`: that comes from a Map keyed by second
 * index, so a second in which no bytes arrived is absent from the map entirely
 * and vanishes from the array. Silence — the one thing that matters most here —
 * would be invisible. `arrivals` is complete and never truncated.
 */
export function rateBetween(arrivals, fromMs, toMs) {
  if (!Array.isArray(arrivals) || arrivals.length < 2) return null;
  if (!(toMs > fromMs)) return null;

  const cumulativeAt = (ms) => {
    // Bytes delivered by `ms`, by walking to the last arrival at or before it.
    let bytes = 0;
    for (const [at, cumulative] of arrivals) {
      if (at > ms) break;
      bytes = cumulative;
    }
    return bytes;
  };

  const bytes = cumulativeAt(toMs) - cumulativeAt(fromMs);
  return +(((bytes * 8) / 1e6 / ((toMs - fromMs) / 1000)).toFixed(2));
}

/**
 * The widest quiet window this feed has already shown itself willing to produce.
 *
 * Deliberately the MAXIMUM inter-arrival gap, not a percentile. A real TS pull
 * delivers in dense bursts — most chunks land in the same millisecond — so the
 * 95th percentile gap is 0 ms and says nothing about how quiet the feed goes.
 * Using it collapsed the allowed silence onto its floor and reported a live
 * eviction (beIN incumbent, Nat Geo newcomer, 2026-09-18) as a fade.
 *
 * The question is not "what is a typical gap" but "how long has this feed gone
 * quiet without being dead", and that is an upper bound. Sensitivity to a single
 * outlier is the point: one 4-second quiet window proves the feed can produce
 * one. Returns null when there is too little to judge.
 */
export function habitualGapMs(arrivals) {
  if (!Array.isArray(arrivals) || arrivals.length < 12) return null;
  let widest = 0;
  for (let i = 1; i < arrivals.length; i += 1) {
    widest = Math.max(widest, arrivals[i][0] - arrivals[i - 1][0]);
  }
  return widest;
}

/**
 * Classify how a transport measurement ended.
 *
 * Takes the object `measureTransport` returns. Reads only fields that are always
 * present, so a result recorded by an older run still classifies.
 */
export function detectDrain(result, options = {}) {
  const {
    tailSeconds = DEFAULT_TAIL_SECONDS,
    healthyRatio = DEFAULT_HEALTHY_RATIO,
    silenceTolerance = DEFAULT_SILENCE_TOLERANCE,
    silenceFloorMs = DEFAULT_SILENCE_FLOOR_MS,
    minJudgeableSeconds = MIN_JUDGEABLE_SECONDS,
  } = options;

  if (!result || typeof result !== "object") {
    return { verdict: "INCONCLUSIVE", drained: false, endedEarly: false, reason: "no measurement supplied", evidence: {} };
  }

  /**
   * Did a connection that was genuinely established get cut short?
   *
   * Kept separate from the verdict because a single short pull is honestly
   * INCONCLUSIVE — 2.5s cannot tell an eviction from a feed that never
   * established — while a *set* of such pulls with one survivor is not ambiguous
   * at all. `detectEviction` needs the fact without the verdict's caution.
   */
  const endedEarly = Boolean(result.earlyClose) && result.status === 200 && Number(result.bytes) > 0;

  const verdict = (name, reason, evidence = {}) => ({
    verdict: name,
    drained: name === "DRAIN",
    endedEarly,
    reason,
    evidence,
  });

  const survived = Number(result.survivedSeconds ?? result.seconds ?? 0);
  const requested = Number(result.requestedSeconds ?? 0);

  // 1. Never started. A refusal is a different fault from a drain, and calling
  //    it a drain would blame contention for a dead feed.
  if (result.status !== 200) {
    return verdict("REFUSED", `upstream refused with ${result.status ?? "no status"}`, {
      status: result.status,
      survivedSeconds: survived,
    });
  }
  if (!(Number(result.bytes) > 0)) {
    return verdict("REFUSED", "connection opened but delivered no bytes", {
      status: result.status,
      survivedSeconds: survived,
    });
  }

  // 2. Ran to the end still delivering. The only verdict that clears a stream.
  if (!result.earlyClose) {
    return verdict("HEALTHY", `delivered the full ${requested || survived}s without the upstream closing`, {
      survivedSeconds: survived,
      requestedSeconds: requested,
    });
  }

  // 3. It ended early. Everything below decides WHY, which is the real question.
  const arrivals = Array.isArray(result.arrivals) ? result.arrivals : [];
  const lastArrivalMs = arrivals.length ? arrivals[arrivals.length - 1][0] : 0;
  const closeMs = survived * 1000;

  if (survived < minJudgeableSeconds) {
    return verdict(
      "INCONCLUSIVE",
      `died after ${survived.toFixed(1)}s — too short to tell an eviction from a feed that never established`,
      { survivedSeconds: survived, lastArrivalMs },
    );
  }

  // Delivery in the window before the close, against the stream's own baseline.
  // Baseline excludes the tail so a long healthy run is not diluted by its end.
  const tailFromMs = Math.max(0, lastArrivalMs - tailSeconds * 1000);
  const tailMbps = rateBetween(arrivals, tailFromMs, lastArrivalMs);
  const baselineMbps = rateBetween(arrivals, 0, tailFromMs);
  const silenceBeforeCloseMs = Math.max(0, Math.round(closeMs - lastArrivalMs));

  const habitualMs = habitualGapMs(arrivals);
  const allowedSilenceMs = Math.max(silenceFloorMs, (habitualMs ?? 0) * silenceTolerance);

  const evidence = {
    survivedSeconds: survived,
    requestedSeconds: requested,
    tailMbps,
    baselineMbps,
    tailRatio: baselineMbps ? +(tailMbps / baselineMbps).toFixed(2) : null,
    silenceBeforeCloseMs,
    habitualGapMs: habitualMs,
    allowedSilenceMs: Math.round(allowedSilenceMs),
    closeReason: result.closeReason ?? null,
  };

  // Quiet for materially longer than this feed's own habit means it faded out.
  if (silenceBeforeCloseMs > allowedSilenceMs) {
    return verdict(
      "DEGRADED",
      `went quiet for ${(silenceBeforeCloseMs / 1000).toFixed(1)}s before the upstream closed, against a habitual ` +
        `${habitualMs === null ? "unknown" : `${(habitualMs / 1000).toFixed(1)}s`} gap — faded, not cut`,
      evidence,
    );
  }

  // Not enough run before the tail to have a baseline to compare against.
  if (baselineMbps === null || baselineMbps === 0) {
    return verdict("INCONCLUSIVE", "no baseline period before the tail to compare against", evidence);
  }

  if (tailMbps >= baselineMbps * healthyRatio) {
    return verdict(
      "DRAIN",
      `delivering ${tailMbps} Mbps (${evidence.tailRatio}x baseline) when the upstream cut it at ${survived.toFixed(1)}s`,
      evidence,
    );
  }

  return verdict(
    "DEGRADED",
    `rate fell to ${tailMbps} Mbps (${evidence.tailRatio}x baseline) before the close — declined, not cut`,
    evidence,
  );
}

/**
 * Classify a SET of concurrent pulls.
 *
 * This is the verdict D.6 needed and did not have. Individually, a connection
 * cut at 2.5s is honestly INCONCLUSIVE. Collectively, five concurrent pulls of
 * which exactly one survives is not ambiguous at all — that is a line serving
 * one connection and evicting the rest, whatever each pull says on its own.
 *
 * Takes the output of `detectDrain` for each concurrent pull.
 */
export function detectEviction(detections) {
  if (!Array.isArray(detections) || detections.length < 2) {
    return {
      verdict: "INCONCLUSIVE",
      reason: "an eviction needs at least two concurrent pulls to be visible",
      survivors: 0,
      cut: 0,
      refused: 0,
    };
  }

  const survivors = detections.filter((d) => d.verdict === "HEALTHY").length;
  const cut = detections.filter((d) => d.endedEarly).length;
  const refused = detections.filter((d) => d.verdict === "REFUSED").length;
  const summary = { survivors, cut, refused, total: detections.length };

  // Every pull refused is an outage, not contention. Calling it an eviction
  // would send the next reader hunting for a viewer who was never there.
  if (refused === detections.length) {
    return { verdict: "INCONCLUSIVE", reason: "every pull was refused upstream — an outage, not an eviction", ...summary };
  }

  if (survivors === 1 && cut >= 1) {
    return {
      verdict: "EVICTION",
      reason: `exactly one of ${detections.length} concurrent pulls survived; ${cut} established and were cut short`,
      ...summary,
    };
  }

  if (survivors === detections.length) {
    return {
      verdict: "NO_EVICTION",
      reason: `all ${detections.length} concurrent pulls ran to completion — the line served them together`,
      ...summary,
    };
  }

  if (survivors === 0) {
    return { verdict: "INCONCLUSIVE", reason: "no pull survived, so there is no served connection to attribute", ...summary };
  }

  return {
    verdict: "INCONCLUSIVE",
    reason: `${survivors} of ${detections.length} survived — neither a clean eviction nor a line serving everyone`,
    ...summary,
  };
}

/** One line, for a console. */
export function formatDrain(detection) {
  return `${detection.verdict.padEnd(12)} ${detection.reason}`;
}
