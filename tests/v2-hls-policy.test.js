import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { KZ_V2_HLS_CONFIG, KZV2Recovery } = require("../assets/js/v2-hls-policy.js");

describe("KZ V2 HLS policy", () => {
  it("uses a fixed live runway with valid hls.js duration settings", () => {
    expect(Object.isFrozen(KZ_V2_HLS_CONFIG)).toBe(true);
    expect(KZ_V2_HLS_CONFIG.liveSyncDuration).toBeGreaterThanOrEqual(12);
    expect(KZ_V2_HLS_CONFIG.liveMaxLatencyDuration).toBeGreaterThan(KZ_V2_HLS_CONFIG.liveSyncDuration);
    expect(KZ_V2_HLS_CONFIG).not.toHaveProperty("liveSyncDurationCount");
    expect(KZ_V2_HLS_CONFIG).not.toHaveProperty("liveMaxLatencyDurationCount");
    expect(KZ_V2_HLS_CONFIG).toMatchObject({
      enableWorker: true,
      liveSyncDuration: 14,
      liveMaxLatencyDuration: 36,
      maxLiveSyncPlaybackRate: 1,
      maxBufferHole: 1.5,
      initialLiveManifestSize: 3,
    });
  });

  it("ignores non-fatal hls.js errors", () => {
    const tracker = KZV2Recovery.create({ now: () => 0 });
    expect(tracker.decide({ type: "networkError", fatal: false })).toEqual({ action: "ignore" });
  });

  it("backs off three fatal network errors, remounts once, then gives up", () => {
    let now = 0;
    const tracker = KZV2Recovery.create({ now: () => now });

    expect(tracker.decide({ type: "networkError", fatal: true })).toEqual({
      action: "resume-load",
      delayMs: 2_000,
    });
    now += 1_000;
    expect(tracker.decide({ type: "networkError", fatal: true })).toEqual({
      action: "resume-load",
      delayMs: 4_000,
    });
    now += 1_000;
    expect(tracker.decide({ type: "networkError", fatal: true })).toEqual({
      action: "resume-load",
      delayMs: 8_000,
    });
    now += 1_000;
    expect(tracker.decide({ type: "networkError", fatal: true })).toEqual({ action: "remount" });
    now += 1_000;
    expect(tracker.decide({ type: "networkError", fatal: true })).toEqual({ action: "give-up" });
  });

  it("repairs media twice, then remounts once", () => {
    let now = 0;
    const tracker = KZV2Recovery.create({ now: () => now });

    expect(tracker.decide({ type: "mediaError", fatal: true })).toEqual({ action: "recover-media" });
    now += 1_000;
    expect(tracker.decide({ type: "mediaError", fatal: true })).toEqual({
      action: "swap-audio-and-recover",
    });
    now += 1_000;
    expect(tracker.decide({ type: "mediaError", fatal: true })).toEqual({ action: "remount" });
    now += 1_000;
    expect(tracker.decide({ type: "mediaError", fatal: true })).toEqual({ action: "give-up" });
  });

  it("remounts once for an unknown fatal type, then gives up inside the minute", () => {
    let now = 0;
    const tracker = KZV2Recovery.create({ now: () => now });
    expect(tracker.decide({ type: "otherError", fatal: true })).toEqual({ action: "remount" });
    now += 1_000;
    expect(tracker.decide({ type: "otherError", fatal: true })).toEqual({ action: "give-up" });
  });

  it("resets exhausted budgets only after continuous playback for 60 seconds", () => {
    let now = 0;
    const tracker = KZV2Recovery.create({ now: () => now });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      tracker.decide({ type: "networkError", fatal: true });
      now += 1_000;
    }
    expect(tracker.decide({ type: "networkError", fatal: true })).toEqual({ action: "remount" });

    for (let second = 0; second <= 60; second += 1) {
      now = 10_000 + second * 1_000;
      tracker.noteProgress();
    }

    now += 1_000;
    expect(tracker.decide({ type: "networkError", fatal: true })).toEqual({
      action: "resume-load",
      delayMs: 2_000,
    });
  });

  it("does not call a stalled gap continuous playback", () => {
    let now = 0;
    const tracker = KZV2Recovery.create({ now: () => now });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      tracker.decide({ type: "networkError", fatal: true });
      now += 1_000;
    }
    expect(tracker.decide({ type: "networkError", fatal: true })).toEqual({ action: "remount" });

    now = 10_000;
    tracker.noteProgress();
    now = 80_000;
    tracker.noteProgress();

    expect(tracker.decide({ type: "networkError", fatal: true })).toEqual({
      action: "resume-load",
      delayMs: 2_000,
    });
  });

  it("allows another remount after the prior remount window expires", () => {
    let now = 0;
    const tracker = KZV2Recovery.create({ now: () => now });
    expect(tracker.decide({ type: "otherError", fatal: true })).toEqual({ action: "remount" });

    now = 61_000;
    expect(tracker.decide({ type: "otherError", fatal: true })).toEqual({ action: "remount" });
  });
});
