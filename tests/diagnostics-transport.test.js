import { describe, expect, it } from "vitest";
import { consumesSlot } from "../scripts/diagnostics/harness.mjs";
import { bufferFloorSeconds, gapRhythm, measureTransport } from "../scripts/diagnostics/transport.mjs";

/**
 * These pin the two things the transport probe got wrong in the field, both of
 * which pointed an investigation at the wrong feed.
 */
describe("gapRhythm", () => {
  // The real beIN 2449 measurement: five gaps, every one within 42 ms of
  // 2000 ms, but spaced 6.0/17.0/16.0/17.1 s — uniform in length, with a
  // cadence that only settles after the first pair. Demanding both at once
  // reported nothing for this train, losing the actual finding.
  const BEIN_2449 = [
    { atSec: 1.9, gapMs: 1999 },
    { atSec: 7.9, gapMs: 1985 },
    { atSec: 24.9, gapMs: 2001 },
    { atSec: 40.9, gapMs: 2013 },
    { atSec: 58.0, gapMs: 2027 },
  ];

  it("calls out uniform gap length even when the cadence settles late", () => {
    const rhythm = gapRhythm(BEIN_2449);
    expect(rhythm).toMatch(/UNIFORM LENGTH/);
    expect(rhythm).toMatch(/timer rather than congestion/);
    // ~2000 ms, not the 1985 floor or the 2027 ceiling.
    expect(rhythm).toMatch(/each ~20[0-9]{2} ms/);
    // The period is the median interval (~17s), not the mean the 6.0s
    // startup interval would drag down to ~14s.
    expect(rhythm).toMatch(/every ~1[67](\.[0-9])?s apart from startup/);
  });

  it("reports the cadence but withholds the timer claim when lengths vary", () => {
    const rhythm = gapRhythm([
      { atSec: 2, gapMs: 1600 },
      { atSec: 18, gapMs: 4800 },
      { atSec: 34, gapMs: 2100 },
    ]);
    expect(rhythm).toMatch(/length varies/);
    expect(rhythm).not.toMatch(/timer rather than congestion/);
  });

  it("stays silent when neither length nor cadence is regular", () => {
    expect(
      gapRhythm([
        { atSec: 2, gapMs: 1600 },
        { atSec: 5, gapMs: 4800 },
        { atSec: 47, gapMs: 2100 },
      ]),
    ).toBeNull();
  });

  it("does not claim a rhythm from one or two gaps", () => {
    // Two points define a period with no evidence that it repeats.
    expect(gapRhythm([{ atSec: 2, gapMs: 2000 }])).toBeNull();
    expect(
      gapRhythm([
        { atSec: 2, gapMs: 2000 },
        { atSec: 18, gapMs: 2000 },
      ]),
    ).toBeNull();
    expect(gapRhythm([])).toBeNull();
    expect(gapRhythm(null)).toBeNull();
  });
});

describe("bufferFloorSeconds", () => {
  const RATE = 131072; // bytes/sec — 1 Mbit/s, a round number to reason in

  /**
   * Delivery that keeps exact pace with RATE in `chunk`-sized flushes, with one
   * silence of `silenceSec` starting at `atSec`. The first flush after the
   * silence carries the whole backlog, so the feed is never short overall —
   * only late. That is the real phenomenon: bytes delayed, not lost.
   */
  const withSilence = ({ chunk = 262144, totalSec = 60, atSec = null, silenceSec = 0 }) => {
    const everyMs = (chunk / RATE) * 1000;
    const arrivals = [];
    for (let ms = 0; ms <= totalSec * 1000; ms += everyMs) {
      const sec = ms / 1000;
      if (atSec !== null && sec > atSec && sec <= atSec + silenceSec) continue;
      // Cumulative is always what *should* have arrived by now.
      arrivals.push([ms, (ms / everyMs + 1) * chunk]);
    }
    return arrivals;
  };

  it("asks nothing of delivery that keeps pace, however batched", () => {
    // 256 KiB flushes arriving exactly when needed. Chunky, but never late —
    // and "chunky" was precisely what the old stall count punished.
    const floor = bufferFloorSeconds(withSilence({}), RATE);
    expect(floor.seconds).toBeLessThan(0.1);
  });

  it("charges a silence its full length in buffer", () => {
    // Four seconds of nothing means a player draining continuously is four
    // seconds short by the time delivery resumes.
    const floor = bufferFloorSeconds(withSilence({ atSec: 20, silenceSec: 4 }), RATE);
    expect(floor.seconds).toBeGreaterThan(3.5);
    expect(floor.seconds).toBeLessThan(4.6);
  });

  it("scales with the silence, which counting quiet seconds did not", () => {
    // The bug this replaces: a fixed 1.5s threshold counted both of these as
    // exactly one stall and could not tell that one is twice as demanding.
    const short = bufferFloorSeconds(withSilence({ atSec: 20, silenceSec: 2 }), RATE);
    const long = bufferFloorSeconds(withSilence({ atSec: 20, silenceSec: 6 }), RATE);
    expect(long.seconds).toBeGreaterThan(short.seconds * 2);
  });

  it("points at when the buffer was emptiest", () => {
    const floor = bufferFloorSeconds(withSilence({ atSec: 20, silenceSec: 4 }), RATE);
    // The worst instant is the resumption — the first flush after the silence,
    // which here is 26s: the 22s and 24s flushes never happened.
    expect(floor.atSec).toBeGreaterThanOrEqual(20);
    expect(floor.atSec).toBeLessThanOrEqual(26);
    expect(floor.bytes).toBeGreaterThan(0);
  });

  it("declines to model what it cannot", () => {
    expect(bufferFloorSeconds([], RATE)).toBeNull();
    expect(bufferFloorSeconds(null, RATE)).toBeNull();
    // A rate of zero makes the model meaningless rather than infinite.
    expect(bufferFloorSeconds(withSilence({}), 0)).toBeNull();
  });
});

describe("the probe refuses to lie about a failed run", () => {
  it("rejects a --seconds value that is not a positive number", async () => {
    // NaN made setTimeout(abort, NaN) fire immediately while the belt-and-braces
    // guard `now - started > (NaN + 5) * 1000` never fired — a zero-length run
    // that still cost a connection setup on a one-slot line.
    // `undefined` is excluded on purpose: it means "use the documented default".
    for (const bad of [Number.NaN, 0, -5, "abc", null, {}]) {
      await expect(
        measureTransport({ origin: "http://127.0.0.1:1", tsUrl: "http://127.0.0.1:1/x", seconds: bad }),
      ).rejects.toThrow(/positive number/);
    }
  });
});

describe("harness slot policy", () => {
  it("refuses /api/iptv-lab/probe, which fetches real media", () => {
    // It reaches probeMediaUrl, which pulls a manifest, a segment AND a TS body.
    // iptv-quality.js and iptv-lab-compat-fallback.js both fire it on playback
    // failure — exactly when a diagnostic is most likely to be running.
    expect(consumesSlot("/api/iptv-lab/probe", "?stream=2449")).toBe(true);
    expect(consumesSlot("/api/xtream/media/abc", "")).toBe(true);
    expect(consumesSlot("/wk/hls/x", "")).toBe(true);
  });

  it("allows the plain status call but refuses its media=1 form", () => {
    // getXtreamStatus only probes channels when media=1 is passed.
    expect(consumesSlot("/api/iptv-lab/status", "")).toBe(false);
    expect(consumesSlot("/api/iptv-lab/status", "?media=1")).toBe(true);
  });

  it("leaves metadata endpoints free", () => {
    for (const p of ["/api/iptv-lab/channel", "/api/iptv-lab/catalog", "/api/football/scoreboard"]) {
      expect(consumesSlot(p, "?id=bein-sports-1")).toBe(false);
    }
  });
});
