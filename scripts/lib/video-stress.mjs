/**
 * Playwright helpers: confirm a frame tree has playing video and stress-test lag.
 */
import { launchBrowser } from "./browser.mjs";

export const DEFAULT_STRESS = {
  warmupMs: 8000,
  stressSeconds: 45,
  sampleIntervalMs: 3000,
  maxStallMs: 15000,
  maxTotalStallMs: 20000,
  minVideoWidth: 1,
};

export async function openVerifyBrowser(options = {}) {
  return launchBrowser({
    headless: options.headless !== false,
    args: ["--autoplay-policy=no-user-gesture-required", ...(options.args || [])],
  });
}

export function findChildFrame(page, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
  return page.frames().find((f) => re.test(f.url()));
}

export async function findFrameWithVideo(page, pattern, { maxDepth = 5, waitMs = 2000, attempts = 15 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const frames = pattern
      ? page.frames().filter((f) => (pattern instanceof RegExp ? pattern : new RegExp(pattern, "i")).test(f.url()))
      : page.frames();
    for (const frame of frames) {
      const hit = await frameHasVideo(frame, { maxDepth });
      if (hit) return hit;
    }
    await page.waitForTimeout(waitMs);
  }
  return null;
}

/** NTV may use cross-origin streams.center Clappr — no readable <video>. */
export async function detectNtvEmbedShell(page) {
  const frames = page.frames().map((f) => f.url());
  const outer = frames.find((u) => /\/wk\/albaplayer\/ntv\//i.test(u));
  const center = frames.find((u) => /streams\.center/i.test(u));
  return {
    outer: outer || null,
    streamsCenter: center || null,
    frameCount: frames.length,
  };
}

async function frameHasVideo(frame, { maxDepth = 4, depth = 0 } = {}) {
  try {
    const state = await frame.evaluate(() => {
      const v = document.querySelector("video");
      if (!v) return null;
      return {
        readyState: v.readyState,
        currentTime: v.currentTime,
        paused: v.paused,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
        muted: v.muted,
      };
    });
    if (state && state.videoWidth >= 1) return { frame, state, depth };
  } catch {
    // Cross-origin or not ready.
  }
  if (depth >= maxDepth) return null;
  for (const child of frame.childFrames()) {
    const nested = await frameHasVideo(child, { maxDepth, depth: depth + 1 });
    if (nested) return nested;
  }
  return null;
}

export async function readVideoState(frame) {
  try {
    return await frame.evaluate(() => {
      const v = document.querySelector("video");
      if (!v) return null;
      return {
        readyState: v.readyState,
        currentTime: v.currentTime,
        paused: v.paused,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
      };
    });
  } catch {
    return null;
  }
}

/**
 * Require visible video and advancing currentTime over a stress window.
 * Returns { ok, reason, samples, stalls, totalStallMs, startedAt, endedAt }.
 */
export async function stressVideoPlayback(frame, opts = {}) {
  const cfg = { ...DEFAULT_STRESS, ...opts };
  const samples = [];
  let stalls = 0;
  let totalStallMs = 0;
  let stallMs = 0;
  let lastCt = null;
  const startedAt = Date.now();

  await frame.page().waitForTimeout(cfg.warmupMs);

  let state = await readVideoState(frame);
  if (!state || state.videoWidth < cfg.minVideoWidth) {
    return { ok: false, reason: "no_video", samples, stalls, totalStallMs, startedAt, endedAt: Date.now() };
  }

  const endAt = Date.now() + cfg.stressSeconds * 1000;
  while (Date.now() < endAt) {
    state = await readVideoState(frame);
    if (!state || state.videoWidth < cfg.minVideoWidth) {
      return { ok: false, reason: "video_lost", samples, stalls, totalStallMs, startedAt, endedAt: Date.now() };
    }

    const sample = {
      t: Date.now(),
      currentTime: state.currentTime,
      paused: state.paused,
      readyState: state.readyState,
    };
    samples.push(sample);

    if (!state.paused && state.readyState >= 2 && state.currentTime > 0) {
      if (lastCt != null && Math.abs(state.currentTime - lastCt) < 0.04) {
        stallMs += cfg.sampleIntervalMs;
        totalStallMs += cfg.sampleIntervalMs;
        if (stallMs >= cfg.maxStallMs) stalls += 1;
      } else {
        stallMs = 0;
      }
      lastCt = state.currentTime;
    } else {
      stallMs = 0;
      lastCt = state.currentTime;
    }

    if (stalls >= 1 && totalStallMs >= cfg.maxTotalStallMs) {
      return {
        ok: false,
        reason: "lag_stall",
        samples,
        stalls,
        totalStallMs,
        startedAt,
        endedAt: Date.now(),
      };
    }

    await frame.page().waitForTimeout(cfg.sampleIntervalMs);
  }

  const first = samples.find((s) => s.currentTime > 0);
  const last = samples[samples.length - 1];
  const advanced = first && last && last.currentTime - first.currentTime >= 0.5;
  if (!advanced) {
    return { ok: false, reason: "time_not_advancing", samples, stalls, totalStallMs, startedAt, endedAt: Date.now() };
  }

  return { ok: true, reason: "ok", samples, stalls, totalStallMs, startedAt, endedAt: Date.now(), lastState: state };
}

export async function verifyFrameVideo(frame, opts = {}) {
  const stress = await stressVideoPlayback(frame, opts);
  return stress;
}
