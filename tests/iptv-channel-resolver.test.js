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

  it("maps the provider's current beIN Sports 2 naming to one canonical key", () => {
    const channels = [
      {
        streamId: 3644,
        name: "beIN_2_VEGA",
        categoryName: "beIN SPORTS VEGA",
        epgChannelId: null,
      },
      {
        streamId: 2464,
        name: "beIN_2SD",
        categoryName: "beIN SPORTS VEGA",
        epgChannelId: null,
      },
      {
        streamId: 3178,
        name: "beIN_2_HD720",
        categoryName: "beIN SPORTS HD",
        epgChannelId: null,
      },
      {
        streamId: 2454,
        name: "beIN_2HD_1080p",
        categoryName: "beIN SPORTS HD",
        epgChannelId: null,
      },
    ];

    expect(channels.map(resolver.channelCanonicalKey)).toEqual([
      "bein-sports-2",
      "bein-sports-2",
      "bein-sports-2",
      "bein-sports-2",
    ]);

    const selected = resolver.resolveChannel({ channelId: "bein-sports-2", channel: "beIN Sports 2" }, channels);

    // The canonical key stays stable while the preferred provider variant and
    // its current numeric stream id remain catalog data.
    expect(selected.streamId).toBe(2454);
    expect(selected.resolver.channelId).toBe("bein-sports-2");
  });

  it("prefers stable provider metadata when the provider supplies it", () => {
    const selected = resolver.resolveChannel({ channelId: "bein-sports-2" }, [
      {
        streamId: 2464,
        name: "beIN_2SD",
        categoryName: "beIN SPORTS VEGA",
        epgChannelId: null,
      },
      {
        streamId: 44022,
        name: "Provider renamed this row",
        categoryName: "Sports",
        epgChannelId: "beinsports2.qa",
      },
    ]);

    expect(selected.streamId).toBe(44022);
    expect(selected.resolver.stableProviderField).toBe("epgChannelId");
    expect(selected.resolver.stableProviderId).toBe("beinsports2.qa");
  });

  it("keeps the canonical key when the provider changes the stream id", () => {
    const before = resolver.resolveChannel({ channelId: "bein-sports-2" }, [
      {
        streamId: 2464,
        name: "beIN_2SD",
        categoryName: "beIN SPORTS VEGA",
      },
    ]);
    const after = resolver.resolveChannel({ channelId: "bein-sports-2" }, [
      {
        streamId: 55123,
        name: "beIN_2SD",
        categoryName: "beIN SPORTS VEGA",
      },
    ]);

    expect(before.resolver.channelId).toBe("bein-sports-2");
    expect(after.resolver.channelId).toBe("bein-sports-2");
    expect(after.streamId).toBe(55123);
  });

  it("does not route a different numbered broadcaster", () => {
    const selected = resolver.resolveChannel({ channelId: "bein-sports-2" }, [
      {
        streamId: 2463,
        name: "beIN_1SD",
        categoryName: "beIN SPORTS VEGA",
      },
    ]);
    expect(selected).toBeNull();
  });

  it("uses the canonical card channel id as the binding key", () => {
    expect(resolver.bindingKey({ channelId: "bein-max-3" })).toBe("channel:bein-max-3");
  });
});
