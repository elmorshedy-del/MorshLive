import { describe, expect, it } from "vitest";
import {
  applyClientEdgeCacheHeaders,
  effectiveEdgeCacheTtl,
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

  it("keeps longer TTLs for media segments", () => {
    const headers = new Headers({ "Cache-Control": "public, max-age=60" });
    applyClientEdgeCacheHeaders(headers);
    expect(headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(headers.get("CDN-Cache-Control")).toBeNull();
    expect(headers.get("Cloudflare-CDN-Cache-Control")).toBeNull();
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
