/**
 * Live HLS recover rules for the clean operator player.
 *
 * Saturday 29 Aug 2026: koralive 1bein1 switched to a 2-second-segment
 * live HLS. `hls.startLoad(-1)` on `waiting` snaps back to a 2-segment
 * live edge (~4s) and looks like a loop. Remounting the catalog iframe
 * on every stall does the same thing from the outside.
 */

export function shouldStartLoadOnWaiting() {
  return false;
}

/**
 * hls.startLoad() uses the configured startPosition (-1). On a 2-second
 * live edge that snaps back to the last 2–3 segments and looks like a loop.
 */
export function shouldStartLoadOnFatalNetworkError() {
  return false;
}

/**
 * hls.js count-based liveSync multiplies TARGETDURATION. When the producer
 * advertises 0 (today's 0.5s window) that product is 0 and the player sits
 * on the live edge, hitch-pausing every fragment. A fixed second gap keeps
 * the same runway on 0.5s and 2s windows.
 */
export function liveSyncBehindSeconds({ targetDuration, count, durationSeconds } = {}) {
  if (durationSeconds != null) return Number(durationSeconds);
  return Number(count) * Number(targetDuration);
}

/** Same lag as yesterday's 3×2s count. Do not mix with liveSyncDurationCount — hls.js throws. */
export function operatorLiveSyncDuration() {
  return 6;
}

export function operatorLiveMaxLatencyDuration() {
  return 12;
}

export function operatorMaxLiveSyncPlaybackRate() {
  return 1;
}

export function operatorHighBufferWatchdogPeriod() {
  return 8;
}

/** Jump sub-second gaps at 2s fragment boundaries instead of pausing. */
export function operatorMaxBufferHole() {
  return 1.5;
}

/** Do not start on a single live-edge fragment. */
export function operatorInitialLiveManifestSize() {
  return 3;
}

export function shouldRotateLiveSources(sourceCount) {
  return Number(sourceCount) > 1;
}

export function shouldReloadAfterSourceCycles(sourceCount, tries, maxCycles = 6) {
  const count = Number(sourceCount) || 0;
  if (count <= 1) return false;
  return Number(tries) > count * maxCycles;
}

export function shouldUseNativeHls(canPlayType, hlsSupported) {
  if (hlsSupported) return false;
  return String(canPlayType || "") === "probably";
}

export function shouldRemountMainPlayer(reason, { allowAutoHeal = true, includeMain = false } = {}) {
  if (allowAutoHeal === false) return false;
  if (includeMain) return true;
  const tag = String(reason || "");
  return tag === "exhausted" || tag === "black";
}
