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

export function shouldRotateLiveSources(sourceCount) {
  return Number(sourceCount) > 1;
}

export function shouldReloadAfterSourceCycles(sourceCount, tries, maxCycles = 6) {
  const count = Number(sourceCount) || 0;
  if (count <= 1) return false;
  return Number(tries) > count * maxCycles;
}

export function shouldRemountMainPlayer(reason, { allowAutoHeal = true, includeMain = false } = {}) {
  if (allowAutoHeal === false) return false;
  if (includeMain) return true;
  const tag = String(reason || "");
  return tag === "exhausted" || tag === "black";
}
