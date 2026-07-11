import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMediaToken,
  decodeMediaToken,
  inspectMpegTsCodecs,
  loadXtreamPortals,
  probeXtreamPlayback,
  proxyXtreamMedia,
} from "../backend/adapters/xtream.js";
import { getXtreamLive } from "../backend/services/xtream.js";

const env = {
  XTREAM_PORTALS_JSON: JSON.stringify({
    portals: [
      {
        url: "http://example.test:8080",
        username: "owner",
        password: "secret",
        label: "Primary",
      },
    ],
  }),
  STREAM_SIGNING_SECRET: "test-signing-secret-not-production",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Xtream adapter", () => {
  it("detects mobile-safe H.264 + AAC transport streams", () => {
    const bytes = new Uint8Array(188 * 2).fill(0xff);
    bytes[0] = 0x47;
    bytes[1] = 0x40;
    bytes[2] = 0x00;
    bytes[3] = 0x10;
    bytes[4] = 0x00;
    bytes.set([0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe1, 0x00], 5);
    bytes[188] = 0x47;
    bytes[189] = 0x41;
    bytes[190] = 0x00;
    bytes[191] = 0x10;
    bytes[192] = 0x00;
    bytes.set(
      [
        0x02, 0xb0, 0x17, 0x00, 0x01, 0xc1, 0x00, 0x00, 0xe1, 0x01, 0xf0, 0x00, 0x1b, 0xe1, 0x01, 0xf0, 0x00,
        0x0f, 0xe1, 0x02, 0xf0, 0x00,
      ],
      193,
    );
    expect(inspectMpegTsCodecs(bytes)).toMatchObject({
      video: "h264",
      audio: "aac",
      mobileCompatible: true,
    });
  });

  it("loads authorized portals from the secret", () => {
    const result = loadXtreamPortals(env);
    expect(result.error).toBeUndefined();
    expect(result.portals).toHaveLength(1);
    expect(result.portals[0]).toMatchObject({
      id: "p1",
      label: "Primary",
      url: "http://example.test:8080",
      username: "owner",
      password: "secret",
    });
  });

  it("round-trips encrypted media tokens", async () => {
    const upstream = "http://example.test:8080/live/owner/secret/123.m3u8";
    const token = await createMediaToken(env, upstream, 60);
    expect(token).not.toContain("owner");
    expect(token).not.toContain("secret");
    await expect(decodeMediaToken(env, token)).resolves.toBe(upstream);
  });

  it("detects a playable HLS stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("#EXTM3U\n#EXTINF:2,\nsegment.ts\n", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        }),
      ),
    );
    const portal = loadXtreamPortals(env).portals[0];
    await expect(probeXtreamPlayback(portal, 123)).resolves.toMatchObject({
      ok: true,
      protocol: "hls",
    });
  });

  it("rewrites manifest media URLs to encrypted same-origin routes", async () => {
    const upstream = "http://example.test:8080/live/owner/secret/123.m3u8";
    const token = await createMediaToken(env, upstream, 60);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:2,\nseg1.ts\n', {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        }),
      ),
    );

    const response = await proxyXtreamMedia(
      new Request(`https://korazero.com/api/xtream/media/${token}`),
      env,
      token,
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("/api/xtream/media/");
    expect(body).not.toContain("seg1.ts");
    expect(body).not.toContain("key.bin");
  });
});

describe("Xtream service", () => {
  it("returns sanitized channels with encrypted playback URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        if (url.includes("get_live_categories")) {
          return new Response(JSON.stringify([{ category_id: "7", category_name: "Sports" }]), {
            status: 200,
          });
        }
        if (url.includes("get_live_streams")) {
          return new Response(JSON.stringify([{ stream_id: 123, name: "Test Sports", category_id: "7" }]), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ user_info: { auth: 1 } }), { status: 200 });
      }),
    );

    const result = await getXtreamLive(env, new URLSearchParams({ q: "sports", limit: "5" }));
    const stream = result.body.portals[0].streams[0];
    expect(stream).toMatchObject({
      portalId: "p1",
      streamId: 123,
      name: "Test Sports",
      categoryName: "Sports",
    });
    expect(stream.playbackUrl).toMatch(/^\/api\/xtream\/media\//);
    expect(stream.tsPlaybackUrl).toMatch(/^\/api\/xtream\/media\//);
    expect(JSON.stringify(result.body)).not.toContain("owner");
    expect(JSON.stringify(result.body)).not.toContain("secret");
  });
});
