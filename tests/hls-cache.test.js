import { describe, expect, it } from "vitest";
import {
  applyClientEdgeCacheHeaders,
  effectiveEdgeCacheTtl,
  hlsProxyBasePath,
  isLivePlaylistTarget,
  rewriteLiveTargetDuration,
  sanitizeLiveTargetDuration,
  shouldEdgeCacheHlsTarget,
  workerOnlyCacheKeyUrl,
} from "../lib/hls-cache.js";

describe("effectiveEdgeCacheTtl", () => {
  it("keeps a producer's shorter live-manifest TTL", () => {
    expect(effectiveEdgeCacheTtl("public, max-age=2", 60)).toBe(2);
  });

  it("preserves the wrapper cap for segments and longer producer TTLs", () => {
    expect(effectiveEdgeCacheTtl("public, max-age=60", 60)).toBe(60);
    expect(effectiveEdgeCacheTtl("public, max-age=3600", 60)).toBe(60);
  });

  it("prefers s-maxage and falls back when no cache age is declared", () => {
    expect(effectiveEdgeCacheTtl("public, max-age=60, s-maxage=3", 60)).toBe(3);
    expect(effectiveEdgeCacheTtl("no-store", 60)).toBe(60);
    expect(effectiveEdgeCacheTtl("", 2)).toBe(2);
  });
});

describe("isLivePlaylistTarget", () => {
  it("treats disguised index.css live playlists as manifests", () => {
    expect(isLivePlaylistTarget("https://kora1.dkorea.dpdns.org/live/kora1/index.css")).toBe(true);
    expect(isLivePlaylistTarget("https://cdn.example/video.m3u8")).toBe(true);
  });

  it("leaves .sss and .ts media segments as segments", () => {
    expect(
      isLivePlaylistTarget("https://kora1.dkorea.dpdns.org/live/kora1/runs/20260829T160633Z/seg-06127.sss"),
    ).toBe(false);
    expect(isLivePlaylistTarget("https://cdn.example/seg.ts")).toBe(false);
  });
});

describe("hlsProxyBasePath", () => {
  it("does not use a .m3u8 or .css path that CF Browser Cache TTL can pin", () => {
    expect(hlsProxyBasePath("https://kora1.dkorea.dpdns.org/live/kora1/index.css")).toBe("/wk/live");
    expect(hlsProxyBasePath("https://cdn.example/video.m3u8")).toBe("/wk/live");
    expect(hlsProxyBasePath("https://cdn.example/seg-06127.sss")).toBe("/wk/seg");
    expect(hlsProxyBasePath("https://cdn.example/seg.ts")).toBe("/wk/seg");
  });
});

describe("shouldEdgeCacheHlsTarget", () => {
  it("never puts a live playlist in the Worker Cache API", () => {
    expect(shouldEdgeCacheHlsTarget("https://kora1.dkorea.dpdns.org/live/kora1/index.css")).toBe(false);
    expect(shouldEdgeCacheHlsTarget("https://cdn.example/video.m3u8")).toBe(false);
    expect(shouldEdgeCacheHlsTarget("https://cdn.example/seg-06127.sss")).toBe(true);
  });
});

describe("applyClientEdgeCacheHeaders", () => {
  it("blocks CDN and browser caching of live manifests", () => {
    const headers = new Headers({ "Cache-Control": "public, max-age=2" });
    applyClientEdgeCacheHeaders(headers);
    expect(headers.get("Cache-Control")).toBe("private, no-store, no-cache, max-age=0, must-revalidate");
    expect(headers.get("CDN-Cache-Control")).toBe("no-store");
    expect(headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
    expect(headers.get("Accept-Ranges")).toBe("none");
    expect(headers.get("Vary")).toBe("*");
  });

  it("no-stores a live manifest even when the producer used a segment TTL", () => {
    const headers = new Headers({ "Cache-Control": "public, max-age=60" });
    applyClientEdgeCacheHeaders(headers, { liveManifest: true });
    expect(headers.get("Cache-Control")).toBe("private, no-store, no-cache, max-age=0, must-revalidate");
    expect(headers.get("CDN-Cache-Control")).toBe("no-store");
  });

  it("keeps longer TTLs for media segments", () => {
    const headers = new Headers({ "Cache-Control": "public, max-age=60" });
    applyClientEdgeCacheHeaders(headers);
    expect(headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(headers.get("CDN-Cache-Control")).toBeNull();
    expect(headers.get("Cloudflare-CDN-Cache-Control")).toBeNull();
  });
});

describe("sanitizeLiveTargetDuration", () => {
  it("replaces a zero target duration from 0.5s live segments", () => {
    expect(sanitizeLiveTargetDuration(0, [0.5, 0.5, 0.5])).toBe(1);
  });

  it("replaces an inflated target duration left by a discontinuity segment", () => {
    expect(sanitizeLiveTargetDuration(68, [0.5, 0.5, 2, 68.275])).toBe(2);
  });

  it("keeps a normal 2-second live target duration", () => {
    expect(sanitizeLiveTargetDuration(2, [2, 2, 2])).toBe(2);
  });

  it("leaves a longer VOD target duration alone", () => {
    expect(sanitizeLiveTargetDuration(15, [15, 15])).toBe(15);
  });
});

describe("rewriteLiveTargetDuration", () => {
  it("rewrites TARGETDURATION 0 so hls.js does not reload on a 0s timer", () => {
    const out = rewriteLiveTargetDuration("#EXTM3U\n#EXT-X-TARGETDURATION:0\n#EXTINF:0.500000,\nseg.ts\n");
    expect(out).toContain("#EXT-X-TARGETDURATION:1");
    expect(out).not.toContain("#EXT-X-TARGETDURATION:0");
  });
});

describe("workerOnlyCacheKeyUrl", () => {
  it("moves Cache API keys off the public host so CDN HITs cannot reuse them", () => {
    const keyed = new URL(
      workerOnlyCacheKeyUrl("https://korazero.com/wk/hls?u=https://cdn.example/index.css&sig=abc"),
    );
    expect(keyed.host).toBe("kz-worker-cache.internal");
    expect(keyed.pathname).toBe("/wk/hls");
    expect(keyed.searchParams.get("u")).toBe("https://cdn.example/index.css");
    expect(keyed.searchParams.get("sig")).toBe("abc");
  });
});
