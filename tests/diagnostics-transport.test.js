import { describe, expect, it } from "vitest";
import { gapRhythm } from "../scripts/diagnostics/transport.mjs";

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
