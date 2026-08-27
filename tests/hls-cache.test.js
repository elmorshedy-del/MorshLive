import { describe, expect, it } from "vitest";
import { effectiveEdgeCacheTtl } from "../lib/hls-cache.js";

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
