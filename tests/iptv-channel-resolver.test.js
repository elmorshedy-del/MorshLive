import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const resolver = require("../assets/js/iptv-channel-resolver.js");

describe("stable IPTV channel identity", () => {
  it("keeps the same logical identity when the provider renames a channel and changes stream id", () => {
    const before = {
      portalId: "p1",
      streamId: 991,
      name: "BEIN SPORTS 1 SD",
      categoryName: "AR BEIN SPORTS SD",
      epgChannelId: "beinsports1.qa",
    };
    const after = {
      portalId: "p1",
      streamId: 44021,
      name: "AR | BN SPORT ONE FHD VIP",
      categoryName: "SPORT PACKAGE NEW",
      epgChannelId: "beinsports1.qa",
    };

    const a = resolver.stableIdentity(before);
    const b = resolver.stableIdentity(after);
    expect(a.logicalKey).toBe("epg:beinsports1.qa");
    expect(b.logicalKey).toBe(a.logicalKey);
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.persistent).toBe(true);
  });

  it("groups many quality/codec versions under one logical channel and picks a deterministic preferred variant", () => {
    const channels = [
      {
        portalId: "p1",
        streamId: 11,
        name: "beIN Sports 2 SD",
        categoryName: "Arabic Sports",
        epgChannelId: "beinsports2.qa",
      },
      {
        portalId: "p1",
        streamId: 12,
        name: "beIN Sports 2 HEVC 4K",
        categoryName: "Arabic Sports",
        epgChannelId: "beinsports2.qa",
      },
      {
        portalId: "p1",
        streamId: 13,
        name: "beIN Sports 2 FHD H264",
        categoryName: "Arabic Sports",
        epgChannelId: "beinsports2.qa",
      },
      {
        portalId: "p1",
        streamId: 14,
        name: "beIN Sports 2 FHD H264 BACKUP",
        categoryName: "Arabic Sports",
        epgChannelId: "beinsports2.qa",
      },
    ];

    const selected = resolver.resolveChannel(
      {
        channelId: "bein-sports-2",
        channel: "beIN Sports 2",
        iptvLogicalKey: "epg:beinsports2.qa",
      },
      channels,
    );

    expect(selected.streamId).toBe(13);
    expect(selected.resolver.logicalKey).toBe("epg:beinsports2.qa");
    expect(selected.resolver.bootstrap).toBe(false);
  });

  it("uses an exact persisted identity even if the new display name is unrecognizable", () => {
    const channels = [
      {
        portalId: "p1",
        streamId: 700,
        name: "SPORT-X PRIMARY 1080",
        categoryName: "PACK 91",
        epgChannelId: "beinsports1.qa",
      },
      {
        portalId: "p1",
        streamId: 701,
        name: "SPORT-Y PRIMARY 1080",
        categoryName: "PACK 91",
        epgChannelId: "beinsports2.qa",
      },
    ];

    const selected = resolver.resolveChannel(
      {
        channelId: "bein-sports-1",
        channel: "beIN Sports 1",
        iptvLogicalKey: "epg:beinsports1.qa",
      },
      channels,
    );

    expect(selected.streamId).toBe(700);
    expect(selected.resolver.fingerprint).toMatch(/^fp1:/);
  });

  it("bootstraps from compact EPG identity when the visible name is unrecognizable", () => {
    const channels = [
      {
        portalId: "p1",
        streamId: 700,
        name: "SPORT-X PRIMARY 1080",
        categoryName: "PACK 91",
        epgChannelId: "beinsports1.qa",
      },
      {
        portalId: "p1",
        streamId: 701,
        name: "SPORT-Y PRIMARY 1080",
        categoryName: "PACK 91",
        epgChannelId: "beinsports2.qa",
      },
    ];

    const selected = resolver.resolveChannel(
      { channelId: "bein-sports-1", channel: "beIN Sports 1" },
      channels,
    );

    expect(selected.streamId).toBe(700);
    expect(selected.resolver.logicalKey).toBe("epg:beinsports1.qa");
    expect(selected.resolver.bootstrap).toBe(true);
  });

  it("does not call a portal stream id persistent when stable provider metadata is absent", () => {
    const identity = resolver.stableIdentity({ portalId: "p1", streamId: 12345, name: "Whatever HD" });
    expect(identity.logicalKey).toBe("portal:p1:stream:12345");
    expect(identity.tier).toBe("portal-stream");
    expect(identity.persistent).toBe(false);
  });

  it("uses canonical broadcaster ids as the persistent binding key", () => {
    expect(resolver.bindingKey({ channelId: "bein-max-3", channel: "Provider can rename this" })).toBe(
      "channel:bein-max-3",
    );
  });
});
