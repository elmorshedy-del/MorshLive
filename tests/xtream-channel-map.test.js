import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseSiteChannelId,
  parseXtreamChannelName,
  rankXtreamCandidates,
  resolveXtreamChannel,
} from "../lib/xtream-channel-map.js";

const CATALOG = JSON.parse(
  readFileSync(new URL("./fixtures/xtream-bein-catalog.json", import.meta.url), "utf8"),
).streams;

const EURO_CHANNELS = [
  "bein-sports-1",
  "bein-sports-2",
  "bein-sports-3",
  "bein-sports-4",
  "bein-sports-5",
  "bein-sports-6",
  "bein-sports-7",
  "bein-sports-8",
  "bein-sports-9",
  "bein-max-1",
  "bein-max-2",
  "bein-max-3",
  "bein-max-4",
];

describe("against the real catalogue", () => {
  it("resolves every European channel the schedule can name", () => {
    for (const id of EURO_CHANNELS) {
      const hit = resolveXtreamChannel(id, CATALOG);
      expect(hit, `${id} must resolve`).not.toBeNull();
      expect(hit.streamId, `${id} needs a stream id`).toMatch(/^\d+$/);
    }
  });

  it("picks the H.264 1080p feed for beIN Sports 1, not a decoy", () => {
    const hit = resolveXtreamChannel("bein-sports-1", CATALOG);
    expect(hit).toMatchObject({ streamId: "2449", name: "beIN_1HD_1080p", codec: "h264" });
  });

  it("gives every channel a distinct stream — the mixup this replaces", () => {
    // Two channels resolving to one stream is exactly how a Madrid page played
    // a PSG match: same feed behind two different fixtures.
    const picked = EURO_CHANNELS.map((id) => resolveXtreamChannel(id, CATALOG).streamId);
    expect(new Set(picked).size).toBe(EURO_CHANNELS.length);
  });

  it("keeps sports and max numbering apart", () => {
    const sports3 = resolveXtreamChannel("bein-sports-3", CATALOG);
    const max3 = resolveXtreamChannel("bein-max-3", CATALOG);
    expect(sports3.streamId).not.toBe(max3.streamId);
    expect(sports3.name).not.toMatch(/max/i);
    expect(max3.name).toMatch(/max/i);
  });

  it("offers fallbacks, all of them the same channel", () => {
    const hit = resolveXtreamChannel("bein-sports-1", CATALOG);
    expect(hit.alternates.length).toBeGreaterThan(2);
    for (const alt of hit.alternates) {
      expect(parseXtreamChannelName(alt.name).number).toBe(1);
      expect(parseXtreamChannelName(alt.name).tier).toBe("sports");
    }
  });

  it("prefers H.264 over the HEVC variants of the same channel", () => {
    const ranked = rankXtreamCandidates("bein-sports-1", CATALOG);
    const firstH265 = ranked.findIndex((r) => r.codec === "h265");
    const lastH264 = ranked.map((r) => r.codec).lastIndexOf("h264");
    expect(firstH265).toBeGreaterThan(lastH264);
  });
});

describe("decoys in the catalogue are never selected", () => {
  const decoys = [
    ["English feed", "beIN_SPORTS_1English_1080p"],
    ["French feed", "beIN_SPORTS_1French_1080p"],
    ["Turkish feed", "BeIN SPORTS 1 HD [TR]"],
    ["Xtra tier", "beIN_SPORTS_1Xtra_1080p"],
    ["AFC tier", "beIN_SPORTS AFC1 HD"],
    ["a movies channel", "beIN Movies Premiere [TR]"],
    ["the MAX tier", "beIN_Max_1_HD"],
  ];

  for (const [label, name] of decoys) {
    it(`rejects ${label} for beIN Sports 1`, () => {
      const only = rankXtreamCandidates("bein-sports-1", [{ streamId: "1", name }]);
      expect(only).toHaveLength(0);
    });
  }

  it("returns null rather than the closest thing when the channel is absent", () => {
    const withoutNine = CATALOG.filter((r) => {
      const p = parseXtreamChannelName(r.name);
      return !(p.tier === "sports" && p.number === 9 && p.language === "ar");
    });
    expect(withoutNine.length).toBeLessThan(CATALOG.length);
    expect(resolveXtreamChannel("bein-sports-9", withoutNine)).toBeNull();
    // The other channels are untouched, so this is a real absence and not a
    // catalogue we accidentally emptied.
    expect(resolveXtreamChannel("bein-sports-8", withoutNine)).not.toBeNull();
  });
});

describe("survives the catalogue being renamed under us", () => {
  // Each of these is the same channel written the way a different provider
  // build writes it. The resolver must read them all as beIN Sports 1.
  const spellings = [
    "beIN_1HD_1080p",
    "beIN 1 HD 1080p",
    "bein-1-hd-1080",
    "BEIN_1_HD_1080P",
    "beIN_SPORTS_1_1080FHD",
    "beIN.Sports.1.FHD",
    "beIN_SPORTS1_HD",
    "  beIN_1_HD720  ",
  ];

  for (const name of spellings) {
    it(`reads ${JSON.stringify(name)} as beIN Sports 1`, () => {
      const parsed = parseXtreamChannelName(name);
      expect(parsed).toMatchObject({ network: "bein", tier: "sports", number: 1, language: "ar" });
    });
  }

  it("still resolves after every name gains a provider suffix", () => {
    const renamed = CATALOG.map((r) => ({ ...r, name: `${r.name} [BACKUP]` }));
    for (const id of EURO_CHANNELS) {
      expect(resolveXtreamChannel(id, renamed), `${id} after rename`).not.toBeNull();
    }
  });

  it("still resolves when the provider switches separators", () => {
    const renamed = CATALOG.map((r) => ({ ...r, name: String(r.name).replace(/_/g, " ") }));
    for (const id of EURO_CHANNELS) {
      expect(resolveXtreamChannel(id, renamed), `${id} after separator change`).not.toBeNull();
    }
  });

  it("still resolves when stream ids are all reissued", () => {
    // The failure mode that broke the old pinned map: ids change, names do not.
    const reissued = CATALOG.map((r, i) => ({ ...r, streamId: String(900000 + i) }));
    const hit = resolveXtreamChannel("bein-sports-1", reissued);
    expect(hit.name).toBe("beIN_1HD_1080p");
    expect(hit.streamId).not.toBe("2449");
  });
});

describe("number extraction does not read quality figures as channels", () => {
  const cases = [
    ["beIN_1_512K", 1],
    ["beIN_SPORTS1_4K", 1],
    ["beIN_Sport_1_H265", 1],
    ["beIN_1_H265_SD", 1],
    ["beIN_2HD_1080p", 2],
    ["beIN_4_HD720", 4],
    ["beIN_Max_4_Ultra_4K", 4],
    ["beIN_9HD_1080p", 9],
  ];

  for (const [name, expected] of cases) {
    it(`${name} is channel ${expected}`, () => {
      expect(parseXtreamChannelName(name).number).toBe(expected);
    });
  }
});

describe("edge cases", () => {
  it("rejects ids that are not a channel", () => {
    for (const bad of ["", null, undefined, "bein-sports", "bein-sports-0", "ssc-1", "bein-max-9x"]) {
      expect(parseSiteChannelId(bad)).toBeNull();
      expect(rankXtreamCandidates(bad, CATALOG)).toEqual([]);
    }
  });

  it("survives a catalogue that is empty, missing or malformed", () => {
    for (const catalog of [[], null, undefined, [{}, { name: null }, { name: 123 }]]) {
      expect(() => resolveXtreamChannel("bein-sports-1", catalog)).not.toThrow();
      expect(resolveXtreamChannel("bein-sports-1", catalog)).toBeNull();
    }
  });

  it("does not invent a channel number that is not there", () => {
    expect(parseXtreamChannelName("beIN_SPORTS_HD").number).toBeNull();
    expect(parseXtreamChannelName("beIN Sports Premium").number).toBeNull();
  });

  it("treats an unnumbered catalogue entry as unusable rather than channel 1", () => {
    const rows = [{ streamId: "5", name: "beIN Sports HD" }];
    expect(rankXtreamCandidates("bein-sports-1", rows)).toHaveLength(0);
  });

  // Saudi Pro League rights moved to Thmanyah for 2025-26, but only beIN was
  // ever resolvable here, so /api/iptv-lab/channel answered "channel not found
  // in catalogue" for every Saudi fixture and the watch page could not mount one.
  describe("Thmanyah", () => {
    // Both spellings the provider ships in a single catalogue, at every quality.
    const THMANYAH_CATALOG = [
      { streamId: "241353", name: "Thmanayah 1 Low" },
      { streamId: "241359", name: "Thmanayah 1 HD" },
      { streamId: "241362", name: "Thmanayah 1 1080" },
      { streamId: "241999", name: "Thmanayah 1 4K" },
      { streamId: "243323", name: "Thamanya 1 Sport HD" },
      { streamId: "241363", name: "Thmanayah 2 1080" },
      { streamId: "243324", name: "Thamanya 2 Sport HD" },
      { streamId: "241364", name: "Thmanayah 3 1080" },
    ];

    it("resolves a numbered channel to its best catalogue entry", () => {
      expect(resolveXtreamChannel("thmanyah-2", THMANYAH_CATALOG)).toMatchObject({
        streamId: "241363",
        quality: "1080",
        codec: "h264",
      });
    });

    it("reads both of the provider's spellings as the same network", () => {
      for (const name of ["Thmanayah 2 1080", "Thamanya 2 Sport HD"]) {
        expect(parseXtreamChannelName(name)).toMatchObject({ network: "thmanyah", number: 2 });
      }
    });

    it("does not read the 4 in 4K as the channel number", () => {
      expect(parseXtreamChannelName("Thmanayah 2 4K")).toMatchObject({ number: 2, quality: "4k" });
    });

    it("prefers 1080 h264 over Low, SD and 4K", () => {
      const ranked = rankXtreamCandidates("thmanyah-1", THMANYAH_CATALOG);
      expect(ranked[0].streamId).toBe("241362");
      expect(ranked.at(-1).quality).toBe("4k");
    });

    it("refuses the bare network id, which names no channel", () => {
      expect(parseSiteChannelId("thmanyah")).toBeNull();
      expect(resolveXtreamChannel("thmanyah", THMANYAH_CATALOG)).toBeNull();
    });

    it("keeps the two networks apart", () => {
      expect(resolveXtreamChannel("thmanyah-1", CATALOG)).toBeNull();
      expect(resolveXtreamChannel("bein-sports-1", THMANYAH_CATALOG)).toBeNull();
    });
  });
});
