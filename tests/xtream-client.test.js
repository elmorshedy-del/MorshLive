import { describe, expect, it } from "vitest";
import {
  isHttpRedirectStatus,
  publicIpv4WildcardHost,
  rewriteXtreamRedirect,
  shouldRetryXtreamMediaWithoutRange,
  XTREAM_CLIENT_USER_AGENT,
  xtreamClientHeaders,
  xtreamMediaHeaders,
} from "../lib/xtream-client.js";

describe("xtreamClientHeaders", () => {
  it("uses the IPTVnator VLC user-agent and drops empty extras", () => {
    expect(XTREAM_CLIENT_USER_AGENT).toBe("VLC/3.0.18 LibVLC/3.0.18");
    expect(xtreamClientHeaders({ Accept: "*/*", Referer: "", Origin: null })).toEqual({
      "User-Agent": XTREAM_CLIENT_USER_AGENT,
      Accept: "*/*",
    });
  });
});

describe("xtreamMediaHeaders", () => {
  it("does not forward a browser user-agent", () => {
    const request = new Request("https://korazero.com/api/xtream/media/token", {
      headers: {
        Accept: "video/mp2t",
        Range: "bytes=0-",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0",
      },
    });
    expect(xtreamMediaHeaders(request)).toEqual({
      "User-Agent": XTREAM_CLIENT_USER_AGENT,
      Accept: "video/mp2t",
      Range: "bytes=0-",
    });
    expect(xtreamMediaHeaders(request, { includeRange: false })).toEqual({
      "User-Agent": XTREAM_CLIENT_USER_AGENT,
      Accept: "video/mp2t",
    });
  });
});

describe("shouldRetryXtreamMediaWithoutRange", () => {
  it("retries only 401/403 after a ranged request", () => {
    expect(shouldRetryXtreamMediaWithoutRange(403, true)).toBe(true);
    expect(shouldRetryXtreamMediaWithoutRange(401, true)).toBe(true);
    expect(shouldRetryXtreamMediaWithoutRange(403, false)).toBe(false);
    expect(shouldRetryXtreamMediaWithoutRange(502, true)).toBe(false);
  });
});

describe("rewriteXtreamRedirect", () => {
  it("detects IPv4 origin hosts and HTTP redirect statuses", () => {
    expect(publicIpv4WildcardHost("8.8.8.8")).toBe("8-8-8-8.sslip.io");
    expect(publicIpv4WildcardHost("edge.example.test")).toBeNull();
    expect(isHttpRedirectStatus(302)).toBe(true);
    expect(isHttpRedirectStatus(200)).toBe(false);
  });

  it("gives a public origin IP a hostname and preserves its signed path", () => {
    const follow = rewriteXtreamRedirect(
      "http://panel.example.test:8080/live/owner/secret/123.ts",
      "http://8.8.8.8:80/live/owner/secret/123.ts?token=abc",
    );
    expect(follow).toBe("http://8-8-8-8.sslip.io/live/owner/secret/123.ts?token=abc");
  });

  it("follows a non-IP Location as-is", () => {
    const follow = rewriteXtreamRedirect(
      "http://panel.example.test/live/owner/secret/123.m3u8",
      "https://cdn.example.test/hls/123.m3u8",
    );
    expect(follow).toBe("https://cdn.example.test/hls/123.m3u8");
  });

  it("never turns private or reserved addresses into outbound hosts", () => {
    for (const host of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "203.0.113.10",
      "224.0.0.1",
    ]) {
      expect(publicIpv4WildcardHost(host)).toBeNull();
    }
  });
});
