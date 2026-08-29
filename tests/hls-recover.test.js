import { describe, expect, it } from "vitest";
import {
  operatorLiveSyncDurationCount,
  shouldReloadAfterSourceCycles,
  shouldRemountMainPlayer,
  shouldRotateLiveSources,
  shouldStartLoadOnFatalNetworkError,
  shouldStartLoadOnWaiting,
  shouldUseNativeHls,
} from "../lib/hls-recover.js";

describe("shouldStartLoadOnWaiting", () => {
  it("never rewinds a live edge on a non-fatal waiting stall", () => {
    expect(shouldStartLoadOnWaiting()).toBe(false);
  });
});

describe("shouldStartLoadOnFatalNetworkError", () => {
  it("does not call startLoad after a fatal network error on 2s live HLS", () => {
    expect(shouldStartLoadOnFatalNetworkError()).toBe(false);
  });
});

describe("operatorLiveSyncDurationCount", () => {
  it("stays more than three 2-second segments behind the live edge", () => {
    expect(operatorLiveSyncDurationCount()).toBeGreaterThan(3);
  });
});

describe("shouldRotateLiveSources", () => {
  it("keeps a single operator source mounted", () => {
    expect(shouldRotateLiveSources(1)).toBe(false);
    expect(shouldRotateLiveSources(0)).toBe(false);
  });

  it("still rotates a multi-mirror VIP pool", () => {
    expect(shouldRotateLiveSources(3)).toBe(true);
  });
});

describe("shouldReloadAfterSourceCycles", () => {
  it("does not location.reload a single live source", () => {
    expect(shouldReloadAfterSourceCycles(1, 99)).toBe(false);
  });

  it("reloads only after the multi-source pool is exhausted", () => {
    expect(shouldReloadAfterSourceCycles(2, 12)).toBe(false);
    expect(shouldReloadAfterSourceCycles(2, 13)).toBe(true);
  });
});

describe("shouldUseNativeHls", () => {
  it("prefers hls.js on Chrome maybe so the playlist is not Range-probed", () => {
    expect(shouldUseNativeHls("maybe", true)).toBe(false);
    expect(shouldUseNativeHls("probably", true)).toBe(false);
  });

  it("keeps native HLS on Safari where hls.js is unavailable", () => {
    expect(shouldUseNativeHls("probably", false)).toBe(true);
    expect(shouldUseNativeHls("maybe", false)).toBe(false);
  });
});

describe("shouldRemountMainPlayer", () => {
  it("does not remount a catalog iframe when auto-heal is off", () => {
    expect(shouldRemountMainPlayer("stall", { allowAutoHeal: false })).toBe(false);
    expect(shouldRemountMainPlayer("watch-stall", { allowAutoHeal: false })).toBe(false);
    expect(shouldRemountMainPlayer("exhausted", { allowAutoHeal: false, includeMain: true })).toBe(false);
  });

  it("does not remount the main player on a stall when heal is allowed", () => {
    expect(shouldRemountMainPlayer("stall", { allowAutoHeal: true })).toBe(false);
    expect(shouldRemountMainPlayer("watch-stall")).toBe(false);
  });

  it("remounts only on exhausted or black when heal is allowed", () => {
    expect(shouldRemountMainPlayer("exhausted")).toBe(true);
    expect(shouldRemountMainPlayer("black")).toBe(true);
    expect(shouldRemountMainPlayer("online", { includeMain: true })).toBe(true);
  });
});
