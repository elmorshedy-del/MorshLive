import { describe, expect, it } from "vitest";
import {
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
