import { afterEach, describe, expect, it, vi } from "vitest";
import { createMediaToken } from "../backend/adapters/xtream.js";
import { proxyXtreamMediaSafe } from "../backend/adapters/xtream-media-safe.js";

const env = {
  STREAM_SIGNING_SECRET: "safe-proxy-test-secret",
};

const TEST_TIMEOUTS = {
  headers: 25,
  sniff: 25,
  pump: 25,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Xtream payload-sniffing media proxy", () => {
  it("streams endless MPEG-TS immediately even when the upstream URL ends in .m3u8", async () => {
    const upstream = "http://provider.test/live/u/p/2454.m3u8";
    const token = await createMediaToken(env, upstream, 60);
    const ts = new Uint8Array(188);
    ts[0] = 0x47;
    ts[1] = 0x40;

    const endlessTs = new ReadableStream({
      start(controller) {
        controller.enqueue(ts);
        // Deliberately never close: a proxy that calls response.text() here
        // will hang forever, matching the production freeze regression.
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(endlessTs, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      ),
    );

    const request = new Request(`https://korazero.com/api/xtream/media/${token}`);
    const response = await Promise.race([
      proxyXtreamMediaSafe(request, env, token),
      new Promise((_, reject) => setTimeout(() => reject(new Error("proxy waited for TS EOF")), 500)),
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    const reader = response.body.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value[0]).toBe(0x47);
    await reader.cancel();
  });

  it("returns 504 and aborts the provider fetch when payload sniffing goes idle", async () => {
    const upstream = "http://provider.test/live/u/p/2454.m3u8";
    const token = await createMediaToken(env, upstream, 60);
    let aborted = false;

    const almostSilent = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0x47]));
        // Fewer than 64 bytes and no EOF: this used to hang before Response.
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        init.signal.addEventListener("abort", () => {
          aborted = true;
        });
        return Promise.resolve(new Response(almostSilent, { status: 200 }));
      }),
    );

    const request = new Request(`https://korazero.com/api/xtream/media/${token}`);
    const response = await proxyXtreamMediaSafe(request, env, token, TEST_TIMEOUTS);

    expect(response.status).toBe(504);
    expect(aborted).toBe(true);
  });

  it("aborts an upstream fetch that never produces response headers", async () => {
    const upstream = "http://provider.test/live/u/p/2454.ts";
    const token = await createMediaToken(env, upstream, 60);
    let aborted = false;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        init.signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise(() => {});
      }),
    );

    const request = new Request(`https://korazero.com/api/xtream/media/${token}`);
    const response = await proxyXtreamMediaSafe(request, env, token, TEST_TIMEOUTS);

    expect(response.status).toBe(504);
    expect(aborted).toBe(true);
  });

  it("aborts a started MPEG-TS stream when the upstream pump goes idle", async () => {
    const upstream = "http://provider.test/live/u/p/2454.ts";
    const token = await createMediaToken(env, upstream, 60);
    let aborted = false;
    const ts = new Uint8Array(188);
    ts[0] = 0x47;

    const stallsAfterStart = new ReadableStream({
      start(controller) {
        controller.enqueue(ts);
        // Enough bytes for sniffing, then silence forever.
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        init.signal.addEventListener("abort", () => {
          aborted = true;
        });
        return Promise.resolve(new Response(stallsAfterStart, { status: 200 }));
      }),
    );

    const request = new Request(`https://korazero.com/api/xtream/media/${token}`);
    const response = await proxyXtreamMediaSafe(request, env, token, TEST_TIMEOUTS);
    expect(response.status).toBe(200);

    const reader = response.body.getReader();
    const first = await reader.read();
    expect(first.value[0]).toBe(0x47);
    const rejectedRead = expect(reader.read()).rejects.toThrow("Xtream upstream idle during media stream");

    await rejectedRead;
    expect(aborted).toBe(true);
  });

  it("still rewrites genuine HLS manifests even with a generic content type", async () => {
    const upstream = "http://provider.test/live/u/p/123.m3u8";
    const token = await createMediaToken(env, upstream, 60);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("#EXTM3U\n#EXTINF:2,\nsegment.ts\n", {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      ),
    );

    const response = await proxyXtreamMediaSafe(
      new Request(`https://korazero.com/api/xtream/media/${token}`),
      env,
      token,
    );
    const body = await response.text();
    expect(response.headers.get("Content-Type")).toBe("application/vnd.apple.mpegurl");
    expect(body).toContain("#EXTM3U");
    expect(body).toContain("/api/xtream/media/");
    expect(body).not.toContain("segment.ts");
  });
});
