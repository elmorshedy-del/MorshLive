import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchBackendRoutes } from "../backend/router.js";
import { backendRoutes } from "../backend/routes/index.js";
import { getIptvLabLive, getIptvLabStatus } from "../backend/services/iptv-lab.js";
import {
  iptvLabWorkerEnv,
  isArBeinSports1SdChannel,
  isArBeinSports2SdChannel,
  isArBeinSportsSdCategory,
  isHevcIptvChannel,
  parseIptvLabSecret,
  pickArBeinSports1Sd,
  pickArBeinSports2Sd,
  preferredIptvLabCategoryId,
} from "../lib/iptv-lab.js";

const labJson = JSON.stringify({
  url: "http://lab.example.test",
  username: "labuser",
  password: "labpass",
  label: "Trial",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AR beIN Sports 1 SD matcher", () => {
  it("accepts the Arabic SD bouquet and rejects TOD / English packs", () => {
    expect(isArBeinSportsSdCategory("AR ❖ BEIN SPORTS SD")).toBe(true);
    expect(isArBeinSportsSdCategory("AR BEIN SPORTS SD")).toBe(true);
    expect(isArBeinSportsSdCategory("BEIN SPORTS TOD")).toBe(false);
    expect(isArBeinSportsSdCategory("BEIN SPORTS 1 ENGLISH SD")).toBe(false);
    expect(isArBeinSportsSdCategory("CA SPORTS")).toBe(false);
    expect(isArBeinSportsSdCategory("FR ❖ BEIN SPORTS SD")).toBe(false);
  });

  it("picks AR BEIN SPORTS 1 SD (991) over English / SD² / other regions", () => {
    const english = {
      streamId: 1003,
      name: "BEIN SPORTS 1 ENGLISH SD",
      categoryName: "AR ❖ BEIN SPORTS SD",
    };
    const sd2 = {
      streamId: 992,
      name: "BEIN SPORTS 1 SD²",
      categoryName: "AR ❖ BEIN SPORTS SD",
    };
    const otherRegion = {
      streamId: 50,
      name: "BEIN SPORTS 1 SD",
      categoryName: "FR ❖ BEIN SPORTS SD",
    };
    const arOne = {
      streamId: 991,
      name: "BEIN SPORTS 1 SD",
      categoryName: "AR ❖ BEIN SPORTS SD",
    };
    expect(isArBeinSports1SdChannel(arOne)).toBe(true);
    expect(isArBeinSports1SdChannel(english)).toBe(false);
    expect(isArBeinSports1SdChannel(sd2)).toBe(false);
    expect(isArBeinSports1SdChannel(otherRegion)).toBe(false);
    expect(
      isArBeinSports1SdChannel({
        streamId: 158887,
        name: "BEIN SPORTS XTRA 1 SD",
        categoryName: "AR ❖ BEIN SPORTS SD",
      }),
    ).toBe(false);
    expect(
      isArBeinSports1SdChannel({
        streamId: 852257,
        name: "BEIN SPORTS AFC 1 SD",
        categoryName: "AR ❖ BEIN SPORTS SD",
      }),
    ).toBe(false);
    expect(pickArBeinSports1Sd([english, sd2, otherRegion, arOne])).toMatchObject({
      streamId: 991,
    });
  });

  it("picks AR BEIN SPORTS 2 SD (992) over English / SD² / other regions", () => {
    const english = {
      streamId: 1004,
      name: "BEIN SPORTS 2 ENGLISH SD",
      categoryName: "AR ❖ BEIN SPORTS SD",
    };
    const sd2 = {
      streamId: 397649,
      name: "BEIN SPORTS 2 SD²",
      categoryName: "AR ❖ BEIN SPORTS SD",
    };
    const otherRegion = {
      streamId: 51,
      name: "BEIN SPORTS 2 SD",
      categoryName: "FR ❖ BEIN SPORTS SD",
    };
    const arTwo = {
      streamId: 992,
      name: "BEIN SPORTS 2 SD",
      categoryName: "AR ❖ BEIN SPORTS SD",
    };
    expect(isArBeinSports2SdChannel(arTwo)).toBe(true);
    expect(isArBeinSports2SdChannel(english)).toBe(false);
    expect(isArBeinSports2SdChannel(sd2)).toBe(false);
    expect(isArBeinSports2SdChannel(otherRegion)).toBe(false);
    expect(
      isArBeinSports2SdChannel({
        streamId: 991,
        name: "BEIN SPORTS 1 SD",
        categoryName: "AR ❖ BEIN SPORTS SD",
      }),
    ).toBe(false);
    expect(pickArBeinSports2Sd([english, sd2, otherRegion, arTwo])).toMatchObject({
      streamId: 992,
    });
  });

  it("prefers the Arabic SD category over CA SPORTS on first load", () => {
    expect(
      preferredIptvLabCategoryId([
        { categoryId: "ca", name: "CA SPORTS" },
        { categoryId: "tod", name: "BEIN SPORTS TOD" },
        { categoryId: "ar-sd", name: "AR ❖ BEIN SPORTS SD" },
      ]),
    ).toBe("ar-sd");
  });

  it("detects HEVC / H.265 channels and bouquets, not the H.264 SD originals", () => {
    expect(isHevcIptvChannel({ name: "BEIN SPORTS 1 HEVC", categoryName: "AR ❖ BEIN SPORTS HEVC" })).toBe(
      true,
    );
    expect(isHevcIptvChannel({ name: "BEIN SPORTS 1 HEVC²", categoryName: "AR ❖ BEIN SPORTS HEVC" })).toBe(
      true,
    );
    expect(isHevcIptvChannel({ name: "BEIN SPORTS 1 H.265", categoryName: "AR ❖ BEIN SPORTS SD" })).toBe(
      true,
    );
    expect(isHevcIptvChannel({ name: "BEIN SPORTS 1 SD", categoryName: "AR ❖ BEIN SPORTS SD" })).toBe(false);
    expect(isHevcIptvChannel({ name: "BEIN SPORTS 1 SD²", categoryName: "AR ❖ BEIN SPORTS SD" })).toBe(false);
  });
});

describe("parseIptvLabSecret", () => {
  it("returns a clear error when the secret is missing", () => {
    expect(parseIptvLabSecret("")).toMatchObject({
      ok: false,
      error: "IPTV_LAB_JSON secret is not configured",
    });
    expect(parseIptvLabSecret(undefined)).toMatchObject({ ok: false });
  });

  it("rejects invalid JSON and non-http URLs", () => {
    expect(parseIptvLabSecret("{").ok).toBe(false);
    expect(
      parseIptvLabSecret(JSON.stringify({ url: "javascript:alert(1)", username: "u", password: "p" })).ok,
    ).toBe(false);
    expect(parseIptvLabSecret(JSON.stringify({ url: "http://x.test", username: "u" })).ok).toBe(false);
  });

  it("accepts host/user/pass aliases and strips query strings", () => {
    const parsed = parseIptvLabSecret(
      JSON.stringify({
        host: "http://64188644.example.test/unused?x=1",
        user: "trial",
        pass: "secret",
      }),
    );
    expect(parsed).toMatchObject({
      ok: true,
      portal: {
        url: "http://64188644.example.test/unused",
        username: "trial",
        password: "secret",
        label: "lab",
      },
    });
  });
});

describe("iptvLabWorkerEnv", () => {
  it("overlays the lab portal without keeping production Xtream portals", () => {
    const original = {
      XTREAM_PORTALS_JSON: JSON.stringify({
        portals: [{ url: "http://prod.example.test", username: "prod", password: "prodpass" }],
      }),
      IPTV_LAB_JSON: labJson,
      STREAM_SIGNING_SECRET: "test-signing-secret-not-production",
    };
    const lab = iptvLabWorkerEnv(original);
    expect(lab.ok).toBe(true);
    expect(original.XTREAM_PORTALS_JSON).toContain("prod.example.test");
    expect(lab.env.XTREAM_PORTALS_JSON).toContain("lab.example.test");
    expect(lab.env.XTREAM_PORTALS_JSON).not.toContain("prod.example.test");
    expect(lab.env.XTREAM_PORTALS_JSON).toContain("labuser");
  });
});

describe("iptv-lab service", () => {
  it("returns 404 when the lab secret is missing", async () => {
    const result = await getIptvLabStatus({}, new URLSearchParams());
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({
      ok: false,
      isolated: true,
      error: "IPTV_LAB_JSON secret is not configured",
    });
  });

  it("lists lab channels through signed media URLs and never leaks credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        const url = String(input);
        expect(url).not.toContain("prod.example.test");
        if (url.includes("get_live_categories")) {
          return new Response(JSON.stringify([{ category_id: "8974", category_name: "BEIN SPORTS TOD" }]), {
            status: 200,
          });
        }
        if (url.includes("get_live_streams")) {
          expect(url).toContain("category_id=8974");
          expect(init.headers["User-Agent"]).toBe("VLC/3.0.18 LibVLC/3.0.18");
          return new Response(
            JSON.stringify([{ stream_id: 42, name: "beIN Sports 1", category_id: "8974" }]),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ user_info: { auth: 1, status: "Active" } }), { status: 200 });
      }),
    );

    const env = {
      XTREAM_PORTALS_JSON: JSON.stringify({
        portals: [{ url: "http://prod.example.test", username: "prod", password: "prodpass" }],
      }),
      IPTV_LAB_JSON: labJson,
      STREAM_SIGNING_SECRET: "test-signing-secret-not-production",
    };
    const result = await getIptvLabLive(
      env,
      new URLSearchParams({ category: "8974", limit: "5", direct: "1" }),
    );
    expect(result.status).toBe(200);
    expect(result.body.isolated).toBe(true);
    expect(result.body.source).toBe("IPTV_LAB_JSON");
    const stream = result.body.portals[0].streams[0];
    expect(stream).toMatchObject({ name: "beIN Sports 1", streamId: 42 });
    expect(stream.playbackUrl).toMatch(/^\/api\/xtream\/media\//);
    expect(stream.directPlaybackUrl).toBeUndefined();
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("labpass");
    expect(serialized).not.toContain("labuser");
    expect(serialized).not.toContain("prodpass");
  });

  it("routes /api/iptv-lab/status independently of XTREAM_PORTALS_JSON", async () => {
    const response = await dispatchBackendRoutes(
      backendRoutes,
      new Request("https://korazero.com/api/iptv-lab/status"),
      {
        XTREAM_PORTALS_JSON: JSON.stringify({
          portals: [{ url: "http://prod.test", username: "u", password: "p" }],
        }),
      },
      {},
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: false,
      isolated: true,
      error: "IPTV_LAB_JSON secret is not configured",
    });
  });
});
