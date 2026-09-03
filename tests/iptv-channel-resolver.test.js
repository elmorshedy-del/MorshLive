import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const resolver = require("../assets/js/iptv-channel-resolver.js");

describe("canonical IPTV channel map", () => {
  it("derives stable canonical keys from card ids and provider EPG ids", () => {
    expect(resolver.canonicalKey("bein-sports-2")).toBe("bein-sports-2");
    expect(resolver.canonicalKey("beinsports2.qa")).toBe("bein-sports-2");
    expect(resolver.canonicalKey("BEIN MAX 1")).toBe("bein-max-1");
  });

  it("maps beIN Sports 2 to the current stream while preserving stable provider metadata", () => {
    const channels = [
      {
        streamId: 992,
        name: "BEIN SPORTS 2 SD",
        categoryName: "AR BEIN SPORTS SD",
        epgChannelId: "beinsports2.qa",
      },
      {
        streamId: 1004,
        name: "BEIN SPORTS 2 ENGLISH SD",
        categoryName: "AR BEIN SPORTS SD",
        epgChannelId: "beinsports2.qa",
      },
      {
        streamId: 397649,
        name: "BEIN SPORTS 2 SD BACKUP",
        categoryName: "AR BEIN SPORTS SD",
        epgChannelId: "beinsports2.qa",
      },
    ];

    const selected = resolver.resolveChannel(
      { channelId: "bein-sports-2", channel: "beIN Sports 2" },
      channels,
    );

    expect(selected.streamId).toBe(992);
    expect(selected.resolver.channelId).toBe("bein-sports-2");
    expect(selected.resolver.stableProviderField).toBe("epgChannelId");
    expect(selected.resolver.stableProviderId).toBe("beinsports2.qa");
  });

  it("keeps the canonical key when the provider changes the stream id", () => {
    const before = resolver.resolveChannel(
      { channelId: "bein-sports-2" },
      [{
        streamId: 992,
        name: "BEIN SPORTS 2 SD",
        categoryName: "AR BEIN SPORTS SD",
        epgChannelId: "beinsports2.qa",
      }],
    );
    const after = resolver.resolveChannel(
      { channelId: "bein-sports-2" },
      [{
        streamId: 44022,
        name: "BN SPORTS 2 SD",
        categoryName: "AR SPORTS",
        epgChannelId: "beinsports2.qa",
      }],
    );

    expect(before.resolver.channelId).toBe("bein-sports-2");
    expect(after.resolver.channelId).toBe("bein-sports-2");
    expect(after.streamId).toBe(44022);
  });

  it("does not route a different numbered broadcaster", () => {
    const selected = resolver.resolveChannel(
      { channelId: "bein-sports-2" },
      [{
        streamId: 991,
        name: "BEIN SPORTS 1 SD",
        categoryName: "AR BEIN SPORTS SD",
        epgChannelId: "beinsports1.qa",
      }],
    );
    expect(selected).toBeNull();
  });

  it("uses the canonical card channel id as the binding key", () => {
    expect(resolver.bindingKey({ channelId: "bein-max-3" })).toBe("channel:bein-max-3");
  });
});
