import { describe, expect, it } from "vitest";
import { classifyDelivery, MediaClock } from "../scripts/diagnostics/ts-analysis.mjs";

const PACKET = 188;
const PCR_PID = 0x100;

/** One 188-byte TS packet carrying a PCR of `seconds`, or plain payload. */
function tsPacket({ pid = PCR_PID, cc = 0, pcrSeconds = null, payload = true } = {}) {
  const p = Buffer.alloc(PACKET, 0xff);
  p[0] = 0x47;
  p[1] = (pid >> 8) & 0x1f;
  p[2] = pid & 0xff;

  if (pcrSeconds === null) {
    p[3] = (payload ? 0b01 : 0b10) << 4;
    p[3] |= cc & 0x0f;
    return p;
  }

  p[3] = (0b11 << 4) | (cc & 0x0f); // adaptation field + payload
  p[4] = 7; // adaptation length: flags + 6 PCR bytes
  p[5] = 0x10; // PCR_flag

  const base = Math.round(pcrSeconds * 90000);
  p[6] = Math.floor(base / 2 ** 25) & 0xff;
  p[7] = Math.floor(base / 2 ** 17) & 0xff;
  p[8] = Math.floor(base / 2 ** 9) & 0xff;
  p[9] = Math.floor(base / 2) & 0xff;
  p[10] = ((base & 1) << 7) | 0x7e;
  p[11] = 0;
  return p;
}

/**
 * Feed a clock a stream whose media time advances by `mediaRate` seconds per
 * wall-clock second. 1.0 is a healthy live feed.
 */
function feed(clock, { seconds, mediaRate = 1, startMedia = 1000, everyMs = 200 }) {
  let cc = 0;
  for (let ms = 0; ms <= seconds * 1000; ms += everyMs) {
    const media = startMedia + (ms / 1000) * mediaRate;
    clock.push(tsPacket({ cc: cc++ & 0x0f, pcrSeconds: media }), ms);
  }
  return clock;
}

describe("MediaClock — PCR parsing", () => {
  it("recovers the encoder timeline from real packet layout", () => {
    const clock = feed(new MediaClock(), { seconds: 10, mediaRate: 1 });
    const r = clock.report(10_000);

    expect(r.ok).toBe(true);
    expect(r.clockPid).toBe(PCR_PID);
    expect(r.mediaSeconds).toBeCloseTo(10, 1);
    expect(r.wallSeconds).toBeCloseTo(10, 1);
    expect(r.mediaPerWall).toBeCloseTo(1, 2);
  });

  it("says so plainly when the payload is not MPEG-TS", () => {
    const clock = new MediaClock();
    clock.push(Buffer.alloc(4096, 0x00), 0);
    const r = clock.report(1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not parse as MPEG-TS/);
  });

  it("says so plainly when it is TS but carries no PCR", () => {
    const clock = new MediaClock();
    for (let i = 0; i < 50; i += 1) clock.push(tsPacket({ cc: i & 0x0f }), i * 10);
    const r = clock.report(1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no PCR/);
  });

  it("re-aligns after corruption instead of giving up", () => {
    const clock = new MediaClock();
    clock.push(tsPacket({ pcrSeconds: 1000 }), 0);
    clock.push(Buffer.alloc(37, 0x11), 10); // garbage, breaks packet alignment
    for (let i = 0; i < 6; i += 1) {
      clock.push(tsPacket({ cc: i & 0x0f, pcrSeconds: 1000.2 * (i + 1) }), 100 + i * 10);
    }
    const r = clock.report(200);
    expect(r.resyncs).toBeGreaterThan(0);
    expect(r.ok).toBe(true);
  });
});

describe("the distinction the old metric could not make", () => {
  it("BATCHED BUT RECOVERS — silence then a burst that repays the debt", () => {
    // Real time passes, media stalls for 3s, then the backlog lands at once.
    const clock = new MediaClock();
    let cc = 0;
    const push = (ms, media) => clock.push(tsPacket({ cc: cc++ & 0x0f, pcrSeconds: media }), ms);
    for (let ms = 0; ms <= 10_000; ms += 200) push(ms, 500 + ms / 1000);
    // 3 seconds of wall clock with nothing arriving...
    // ...then the whole backlog, so media time is level with wall time again.
    for (let ms = 13_000; ms <= 20_000; ms += 200) push(ms, 500 + ms / 1000);

    const r = clock.report(20_000);
    const verdict = classifyDelivery(r);

    expect(r.maxDeficitSec).toBeGreaterThan(1.5);
    expect(r.recovered).toBe(true);
    expect(verdict.verdict).toBe("BATCHED BUT RECOVERS");
  });

  it("STARVING — media falls progressively behind and never repays", () => {
    // 0.7x real time for the whole window: the shape sustained under-delivery
    // takes, and precisely what a self-normalised metric scores as perfect.
    const clock = feed(new MediaClock(), { seconds: 30, mediaRate: 0.7 });
    const r = clock.report(30_000);
    const verdict = classifyDelivery(r);

    expect(r.mediaPerWall).toBeLessThan(0.8);
    expect(r.finalDeficitSec).toBeGreaterThan(5);
    expect(r.recovered).toBe(false);
    expect(verdict.verdict).toBe("STARVING");
  });

  it("KEEPS REAL TIME — a healthy live feed", () => {
    const r = feed(new MediaClock(), { seconds: 30, mediaRate: 1 }).report(30_000);
    expect(classifyDelivery(r).verdict).toBe("KEEPS REAL TIME");
  });

  it("is not fooled by the feed's own bitrate, which is the circularity it replaces", () => {
    // Same media rate, wildly different byte rates — the media clock is
    // indifferent to how many bytes carried those seconds.
    const thin = feed(new MediaClock(), { seconds: 20, mediaRate: 0.7, everyMs: 500 });
    const fat = feed(new MediaClock(), { seconds: 20, mediaRate: 0.7, everyMs: 50 });
    expect(classifyDelivery(thin.report(20_000)).verdict).toBe("STARVING");
    expect(classifyDelivery(fat.report(20_000)).verdict).toBe("STARVING");
  });
});

describe("timeline faults", () => {
  it("flags a PCR jump as content missing rather than late", () => {
    const clock = new MediaClock();
    let cc = 0;
    for (let ms = 0; ms <= 5000; ms += 200) {
      clock.push(tsPacket({ cc: cc++ & 0x0f, pcrSeconds: 800 + ms / 1000 }), ms);
    }
    // The encoder clock leaps 30s forward in 200ms of wall time.
    for (let ms = 5200; ms <= 10_000; ms += 200) {
      clock.push(tsPacket({ cc: cc++ & 0x0f, pcrSeconds: 835 + ms / 1000 }), ms);
    }
    const r = clock.report(10_000);
    expect(r.discontinuities).toBeGreaterThan(0);
    expect(classifyDelivery(r).verdict).toBe("TIMELINE BREAKS");
  });

  it("counts continuity gaps but tolerates legal duplicate packets", () => {
    const clock = new MediaClock();
    clock.push(tsPacket({ cc: 0, pcrSeconds: 100 }), 0);
    clock.push(tsPacket({ cc: 1, pcrSeconds: 100.2 }), 10);
    clock.push(tsPacket({ cc: 1, pcrSeconds: 100.2 }), 20); // legal duplicate
    clock.push(tsPacket({ cc: 5, pcrSeconds: 100.4 }), 30); // skipped 2,3,4
    const r = clock.report(40);
    expect(r.continuityErrors).toBe(1);
    expect(r.continuityDetail[0]).toMatchObject({ expected: 2, got: 5 });
  });

  it("unwraps the 33-bit counter rather than reading a rollover as a jump back", () => {
    const wrapAt = 2 ** 33 / 90000;
    const clock = new MediaClock();
    let cc = 0;
    clock.push(tsPacket({ cc: cc++, pcrSeconds: wrapAt - 0.4 }), 0);
    clock.push(tsPacket({ cc: cc++, pcrSeconds: wrapAt - 0.2 }), 200);
    clock.push(tsPacket({ cc: cc++, pcrSeconds: 0.0 }), 400); // wrapped
    clock.push(tsPacket({ cc: cc++, pcrSeconds: 0.2 }), 600);
    const r = clock.report(600);
    expect(r.mediaSeconds).toBeCloseTo(0.6, 1);
    expect(r.discontinuities).toBe(0);
  });
});
