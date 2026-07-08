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

/** NTV edgestream — known to lag; align with worker NTV stall tolerance. */
export const NTV_STRESS = {
  ...DEFAULT_STRESS,
  maxStallMs: 18000,
  maxTotalStallMs: 45000,
  minAdvanceSeconds: 0.25,
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

/** NTV may use cross-origin streams.center Clappr — verify shell is not dead. */
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

/** True only when streams.center iframe loads real content (not 403 Forbidden). */
export async function ntvEmbedShellPlayable(page) {
  const embed = await detectNtvEmbedShell(page);
  if (!embed.streamsCenter) return { ok: false, reason: "no_ntv_shell", embed };
  const centerFrame = page.frames().find((f) => /streams\.center/i.test(f.url()));
  if (!centerFrame) return { ok: false, reason: "no_center_frame", embed };
  let shellText = "";
  try {
    shellText = await centerFrame.evaluate(() => (document.body && document.body.innerText) || "");
  } catch {
    return { ok: false, reason: "center_cross_origin", embed };
  }
  if (/forbidden|access denied|blocked/i.test(shellText)) {
    return { ok: false, reason: "embed_forbidden", embed, shellText: shellText.trim().slice(0, 120) };
  }
  const videoHit = await findFrameWithVideo(page, null, { attempts: 8, waitMs: 2000 });
  if (videoHit && videoHit.state.videoWidth > 0 && videoHit.state.currentTime > 0) {
    return { ok: true, reason: "embed_video", embed, videoHit };
  }
  return { ok: false, reason: "embed_no_video", embed, shellText: shellText.trim().slice(0, 120) };
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
  const minAdvance = cfg.minAdvanceSeconds ?? 0.5;
  const advanced = first && last && last.currentTime - first.currentTime >= minAdvance;
  if (!advanced) {
    return { ok: false, reason: "time_not_advancing", samples, stalls, totalStallMs, startedAt, endedAt: Date.now() };
  }

  return { ok: true, reason: "ok", samples, stalls, totalStallMs, startedAt, endedAt: Date.now(), lastState: state, laggy: stalls >= 1 || totalStallMs >= cfg.maxStallMs };
}

/** Pass when video plays but stalls (NTV / known-laggy paths). */
export function classifyStress(stress, { allowLaggy = false } = {}) {
  if (stress.ok) return { ok: true, laggy: !!stress.laggy, reason: stress.reason };
  if (!allowLaggy) return { ok: false, laggy: false, reason: stress.reason };
  const first = stress.samples?.find((s) => s.currentTime > 0);
  const last = stress.samples?.[stress.samples.length - 1];
  const advanced = first && last && last.currentTime - first.currentTime >= 0.25;
  if (
    advanced &&
    (stress.reason === "lag_stall" || stress.reason === "time_not_advancing") &&
    stress.samples?.length >= 3
  ) {
    return { ok: true, laggy: true, reason: "laggy_ok" };
  }
  return { ok: false, laggy: false, reason: stress.reason };
}

export async function verifyFrameVideo(frame, opts = {}) {
  const stress = await stressVideoPlayback(frame, opts);
  return stress;
}
