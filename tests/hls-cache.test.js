import { describe, expect, it } from "vitest";
import { applyClientEdgeCacheHeaders, effectiveEdgeCacheTtl } from "../lib/hls-cache.js";

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
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(headers.get("CDN-Cache-Control")).toBe("no-store");
    expect(headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
  });

  it("keeps longer TTLs for media segments", () => {
    const headers = new Headers({ "Cache-Control": "public, max-age=60" });
    applyClientEdgeCacheHeaders(headers);
    expect(headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(headers.get("CDN-Cache-Control")).toBeNull();
    expect(headers.get("Cloudflare-CDN-Cache-Control")).toBeNull();
  });
});
