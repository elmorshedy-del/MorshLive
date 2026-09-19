import { describe, expect, it } from "vitest";
import { detectDrain, detectEviction, rateBetween } from "../scripts/diagnostics/drain-detect.mjs";

/**
 * Build a transport-shaped result with a synthetic arrival series.
 *
 * `mbpsAt(second)` returns the delivery rate at that second, so a test can
 * describe a shape — steady, decaying, guillotined — rather than hand-write
 * cumulative byte counts.
 */
function fakePull({
  seconds,
  requested = 150,
  mbpsAt = () => 8,
  earlyClose = null,
  status = 200,
  silenceMs = 0,
}) {
  const arrivals = [];
  let cumulative = 0;
  const deliverUntilMs = seconds * 1000 - silenceMs;
  // One arrival every 100 ms, which is roughly how a real TS pull lands — but
  // ONLY when bytes actually arrive. An earlier version of this helper pushed an
  // entry every tick regardless, so a quiet window still advanced the last
  // arrival time and silence became invisible. That is the opposite of how
  // `measureTransport` behaves (it appends only inside the chunk loop), and it
  // made the helper unable to express the one signal the detector keys on.
  for (let ms = 100; ms <= deliverUntilMs; ms += 100) {
    const mbps = mbpsAt(ms / 1000);
    if (mbps <= 0) continue;
    cumulative += (mbps * 1e6 * 0.1) / 8;
    arrivals.push([ms, Math.round(cumulative)]);
  }
  return {
    status,
    bytes: Math.round(cumulative),
    seconds,
    survivedSeconds: seconds,
    requestedSeconds: requested,
    earlyClose: earlyClose ?? seconds < requested * 0.95,
    closeReason: null,
    arrivals,
  };
}

describe("rateBetween", () => {
  /** The primitive every verdict rests on: bytes between two offsets, as Mbps. */
  it("computes the delivered rate over a window", () => {
    // 1 MB per 100 ms == 80 Mbps.
    const arrivals = [
      [0, 0],
      [100, 1e6],
      [200, 2e6],
      [300, 3e6],
    ];
    expect(rateBetween(arrivals, 0, 300)).toBeCloseTo(80, 1);
  });

  it("returns null rather than guessing when the window is empty or backwards", () => {
    expect(rateBetween([[0, 0]], 0, 100)).toBeNull();
    expect(
      rateBetween(
        [
          [0, 0],
          [100, 1e6],
        ],
        200,
        100,
      ),
    ).toBeNull();
  });
});

describe("detectDrain", () => {
  it("clears a stream that ran the full duration still delivering", () => {
    const detection = detectDrain(fakePull({ seconds: 150, requested: 150 }));
    expect(detection.verdict).toBe("HEALTHY");
    expect(detection.drained).toBe(false);
  });

  /**
   * The case the module exists for: the incumbent in the staggered test. Full
   * rate for 62 seconds, then the upstream cuts it. Nothing decays first.
   */
  it("reports DRAIN when a stream at full rate is cut mid-delivery", () => {
    const detection = detectDrain(fakePull({ seconds: 62, requested: 150, mbpsAt: () => 8 }));
    expect(detection.verdict).toBe("DRAIN");
    expect(detection.drained).toBe(true);
    expect(detection.evidence.tailRatio).toBeGreaterThan(0.9);
  });

  /**
   * The discriminator. A feed collapsing under its own weight also ends early,
   * so "ended early" cannot be the test. This one decays for 20s before it
   * stops — calling it a drain would blame contention for a failing feed.
   */
  it("reports DEGRADED when the rate decays before the close", () => {
    const detection = detectDrain(
      fakePull({
        seconds: 62,
        requested: 150,
        mbpsAt: (s) => (s < 42 ? 8 : Math.max(0.2, 8 * (1 - (s - 42) / 20))),
      }),
    );
    expect(detection.verdict).toBe("DEGRADED");
    expect(detection.drained).toBe(false);
  });

  /**
   * The other way to fade: full rate, then nothing at all for ten seconds, then
   * the body ends. The tail rate over the delivered window still looks healthy,
   * so only the silence distinguishes it from a cut.
   */
  it("reports DEGRADED when the stream goes silent before the body ends", () => {
    const detection = detectDrain(fakePull({ seconds: 62, requested: 150, silenceMs: 10_000 }));
    expect(detection.verdict).toBe("DEGRADED");
    expect(detection.evidence.silenceBeforeCloseMs).toBeGreaterThan(9000);
  });

  /**
   * REGRESSION — the exact shape that produced the wrong D.6 conclusion.
   *
   * Five 15-second pulls, each evicted after ~2.5s having delivered several MB.
   * The old criterion was `status === 200 && bytes > 0`, so every one scored as
   * served and the limit was declared falsified.
   *
   * The requirement here is NOT that this returns DRAIN — 2.5s genuinely cannot
   * distinguish an eviction from a feed that never established. The requirement
   * is that it must never come back as a pass. A short pull is missing evidence,
   * not good news.
   */
  it("never calls a 15s pull healthy just because bytes arrived (the D.6 bug)", () => {
    const detection = detectDrain(fakePull({ seconds: 2.5, requested: 15, mbpsAt: () => 26 }));
    expect(detection.verdict).not.toBe("HEALTHY");
    expect(detection.drained).toBe(false);
    expect(detection.verdict).toBe("INCONCLUSIVE");
    expect(detection.reason).toMatch(/too short/);
  });

  /**
   * A dead feed is not a drain, and must never be counted as one — D.7 caught
   * `2449` returning 503 to a lone connection on an idle line. Blaming that on
   * contention would send the next reader hunting for a second viewer that was
   * never there.
   *
   * Shaped exactly as `measureTransport` returns on refusal, which has NO
   * `arrivals` key, so this also proves the detector survives the real object.
   */
  it("reports REFUSED for a 503, on the real refusal object", () => {
    const detection = detectDrain({
      status: 503,
      bytes: 0,
      error: "upstream 503",
      requestedSeconds: 150,
      survivedSeconds: 0.42,
      earlyClose: true,
      closeReason: "upstream refused with 503",
      seconds: 0.42,
    });
    expect(detection.verdict).toBe("REFUSED");
    expect(detection.drained).toBe(false);
  });

  /**
   * The dangerous false negative. M9 established that healthy delivery is
   * BURSTY — quiet windows of a second or two, then a catch-up burst. So an
   * eviction can land inside a natural quiet window, and the stream will look
   * silent at the moment it died through no fault of its own.
   *
   * Asserts the measured silence, not just the verdict: a detector that reached
   * the right answer while believing there was no silence would be right by
   * accident, and would break on the next feed.
   */
  it("still reports DRAIN when the cut lands inside a natural quiet window", () => {
    const burst = (s) => (s % 2 < 0.2 ? 80 : 0);
    const detection = detectDrain(fakePull({ seconds: 63.5, requested: 150, mbpsAt: burst }));
    expect(detection.evidence.silenceBeforeCloseMs).toBeGreaterThan(1000);
    expect(detection.evidence.silenceBeforeCloseMs).toBeLessThan(2000);
    expect(detection.verdict).toBe("DRAIN");
  });

  /**
   * A fixed silence threshold cannot work, because "normal silence" is a
   * property of the feed. This one flushes every 4s — so a 3.1s quiet window is
   * its ordinary rhythm, not a fade. Judged against a fixed 2.5s cutoff it would
   * be called DEGRADED and a real eviction would go unreported.
   *
   * The stream's own gap distribution is the only honest baseline.
   */
  it("judges silence against the feed's own rhythm, not a fixed threshold", () => {
    const slowFlush = (s) => (s % 4 < 0.4 ? 80 : 0);
    const detection = detectDrain(fakePull({ seconds: 63.5, requested: 150, mbpsAt: slowFlush }));
    expect(detection.evidence.silenceBeforeCloseMs).toBeGreaterThan(3000);
    expect(detection.verdict).toBe("DRAIN");
  });
});

/**
 * REGRESSION — found on real data, 2026-09-18, not in a fixture.
 *
 * A live eviction (beIN incumbent, Nat Geo newcomer) came back DEGRADED instead
 * of DRAIN. The reason was the baseline: a real TS pull delivers in dense
 * bursts, with most chunks landing in the same millisecond, so the 95th
 * percentile inter-arrival gap is 0.0s. That collapsed the allowed silence onto
 * its floor, while the actual connection teardown left 1.2s of quiet after the
 * final chunk — and a real drain was reported as a fade.
 *
 * A percentile describes the typical gap. What is needed is the WIDEST quiet
 * window the feed has already shown itself willing to produce.
 */
describe("detectDrain against real-shaped arrivals", () => {
  /** Dense bursts, an occasional 2s quiet window — how a real TS pull lands. */
  function realShapedPull({ seconds, requested, trailingSilenceMs }) {
    const arrivals = [];
    let cumulative = 0;
    let ms = 0;
    while (ms < seconds * 1000 - trailingSilenceMs) {
      // A burst: 40 chunks landing within the same few milliseconds.
      for (let i = 0; i < 40; i += 1) {
        cumulative += 16_000;
        arrivals.push([ms + (i % 3), cumulative]);
      }
      ms += 2000; // then a two-second quiet window
    }
    return {
      status: 200,
      bytes: cumulative,
      seconds,
      survivedSeconds: seconds,
      requestedSeconds: requested,
      earlyClose: true,
      closeReason: "upstream closed the body",
      arrivals,
    };
  }

  it("reports DRAIN for a bursty feed cut with a short teardown silence", () => {
    const detection = detectDrain(realShapedPull({ seconds: 61, requested: 150, trailingSilenceMs: 1200 }));
    expect(detection.evidence.silenceBeforeCloseMs).toBeGreaterThan(1000);
    expect(detection.verdict).toBe("DRAIN");
  });
});

describe("detectEviction", () => {
  /**
   * A single 2.5s death is honestly INCONCLUSIVE — it cannot be told from a feed
   * that never established. But FIVE concurrent pulls of which exactly one
   * survives is not ambiguous at all, whatever each one says alone. This is the
   * shape D.6 measured and scored as five successes.
   */
  it("calls one survivor out of five an EVICTION", () => {
    const detections = [
      detectDrain(fakePull({ seconds: 150, requested: 150 })),
      ...Array.from({ length: 4 }, () =>
        detectDrain(fakePull({ seconds: 2.5, requested: 150, mbpsAt: () => 26 })),
      ),
    ];
    const fleet = detectEviction(detections);
    expect(fleet.verdict).toBe("EVICTION");
    expect(fleet.survivors).toBe(1);
    expect(fleet.cut).toBe(4);
  });

  /** All five surviving is the result that would have falsified the limit. */
  it("reports NO_EVICTION when every concurrent pull survives", () => {
    const detections = Array.from({ length: 5 }, () =>
      detectDrain(fakePull({ seconds: 150, requested: 150 })),
    );
    expect(detectEviction(detections).verdict).toBe("NO_EVICTION");
  });

  /** Dead feeds are not evictions — five 503s mean an outage, not contention. */
  it("does not mistake a row of 503s for an eviction", () => {
    const refusals = Array.from({ length: 5 }, () =>
      detectDrain({ status: 503, bytes: 0, survivedSeconds: 0.4, requestedSeconds: 150, earlyClose: true }),
    );
    expect(detectEviction(refusals).verdict).not.toBe("EVICTION");
  });
});
