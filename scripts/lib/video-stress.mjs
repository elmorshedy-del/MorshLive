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

/** Readable iframe/main bodies that mean the player is dead — global for all layers. */
export const DEAD_SHELL_PATTERNS = [
  /forbidden/i,
  /access denied/i,
  /upstream unavailable/i,
  /invalid or expired stream token/i,
  /not available/i,
  /geo.?block/i,
];

export function isDeadShellText(text) {
  const blob = String(text || "").trim();
  if (!blob) return false;
  if (blob.length <= 80 && DEAD_SHELL_PATTERNS.some((re) => re.test(blob))) return true;
  return DEAD_SHELL_PATTERNS.some((re) => re.test(blob.slice(0, 500)));
}

/** Scan every frame we can read for forbidden/unavailable shells. */
export async function scanDeadShells(page) {
  const hits = [];
  for (const frame of page.frames()) {
    try {
      const text = await frame.evaluate(() => (document.body && document.body.innerText) || "");
      if (isDeadShellText(text)) {
        hits.push({ url: frame.url(), text: text.trim().slice(0, 120) });
      }
    } catch {
      // Cross-origin — skip.
    }
  }
  return hits;
}

/**
 * Global player audit: fail on dead shells / 502 pages; pass only on advancing video.
 * Used by prekickoff for main, amine, sirTv, ntv, kooraCity proxies.
 */
export async function auditPlayerPlayable(page, {
  framePattern = null,
  stressSeconds = DEFAULT_STRESS.stressSeconds,
  stressOpts = {},
  allowLaggy = false,
  warmupMs = 12000,
  findAttempts = 20,
} = {}) {
  if (warmupMs > 0) await page.waitForTimeout(warmupMs);

  let mainText = "";
  try {
    mainText = await page.evaluate(() => (document.body && document.body.innerText) || "");
  } catch {
    /* ignore */
  }
  if (/upstream unavailable/i.test(mainText) || /^502$/i.test(mainText.trim())) {
    return { ok: false, reason: "dead_upstream", shellText: mainText.trim().slice(0, 120) };
  }

  const deadShells = await scanDeadShells(page);
  if (deadShells.length) {
    return {
      ok: false,
      reason: "embed_forbidden",
      deadShells,
      shellText: deadShells[0].text,
      frameUrl: deadShells[0].url,
    };
  }

  const videoHit = await findFrameWithVideo(page, framePattern, { attempts: findAttempts, waitMs: 2000 });
  if (!videoHit) {
    return { ok: false, reason: "no_video_frame", deadShells };
  }

  const stressCfg = { ...stressOpts, stressSeconds };
  const stress = await verifyFrameVideo(videoHit.frame, stressCfg);
  const verdict = classifyStress(stress, { allowLaggy });
  return {
    ok: verdict.ok,
    reason: verdict.reason,
    laggy: verdict.laggy,
    frameUrl: videoHit.frame.url(),
    mode: "video",
    stress: {
      reason: stress.reason,
      stalls: stress.stalls,
      totalStallMs: stress.totalStallMs,
      samples: stress.samples?.length || 0,
      laggy: stress.laggy,
    },
    videoHit,
    deadShells,
  };
}

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
  const audit = await auditPlayerPlayable(page, {
    framePattern: null,
    stressSeconds: NTV_STRESS.stressSeconds,
    stressOpts: NTV_STRESS,
    allowLaggy: true,
    warmupMs: 0,
    findAttempts: 8,
  });
  const embed = await detectNtvEmbedShell(page);
  if (audit.ok) {
    return { ok: true, reason: audit.reason, embed, videoHit: audit.videoHit, laggy: audit.laggy };
  }
  if (audit.reason === "no_video_frame" && embed.streamsCenter) {
    return {
      ok: false,
      reason: "embed_no_video",
      embed,
      shellText: audit.shellText || null,
      deadShells: audit.deadShells,
    };
  }
  return {
    ok: false,
    reason: audit.reason,
    embed,
    shellText: audit.shellText || null,
    deadShells: audit.deadShells,
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
