const { describe, expect, it } = require("vitest");
const {
  applySaudiTvGuide,
  guidePairKey,
  normalizeSaudiTeam,
  parseSaudiTvGuide,
} = require("../scripts/saudi-tv-guide-lib");

function guideCell(name, channels, startDate = "2026-09-04T17:00:00") {
  return `
    <td class="canales">
      <div itemscope itemtype="https://schema.org/Event">
        <meta itemprop="name" content="${name}" />
        <meta itemprop="startDate" content="${startDate}" />
      </div>
      <ul class="listaCanales">
        ${channels.map((channel) => `<li title="${channel}"><a>${channel}</a></li>`).join("")}
      </ul>
    </td>`;
}

describe("Saudi TV guide team identity", () => {
  it("normalizes common guide suffixes and Saudi naming variants", () => {
    expect(normalizeSaudiTeam("Abha Club")).toBe("abha");
    expect(normalizeSaudiTeam("Al-Ittihad Jeddah Club")).toBe("ittihad");
    expect(normalizeSaudiTeam("Al Ittihad")).toBe("ittihad");
    expect(normalizeSaudiTeam("Al-Riyadh SC")).toBe("riyadh");
    expect(normalizeSaudiTeam("Al Riyadh")).toBe("riyadh");
    expect(normalizeSaudiTeam("Khaleej FC")).toBe("khaleej");
    expect(normalizeSaudiTeam("Al Khaleej")).toBe("khaleej");
  });

  it("produces the same pair key regardless of home/away order and guide suffixes", () => {
    expect(guidePairKey("Al-Ittihad Jeddah Club", "Al Nassr")).toBe(guidePairKey("Al Nassr", "Al Ittihad"));
  });
});

describe("Saudi TV guide parser", () => {
  it("extracts exact numbered Thmanyah assignments", () => {
    const html = [
      guideCell("Abha Club - Al Ettifaq", ["Thmanyah Channels", "Thmanyah App", "Thmanyah 2 HD"]),
      guideCell("Al Shabab FC - Al Hilal", ["Thmanyah 1 HD"]),
      guideCell("Al Ahli - Al-Riyadh SC", ["Thmanyah App", "Thmanyah 3 HD"]),
    ].join("\n");

    expect(parseSaudiTvGuide(html)).toEqual([
      expect.objectContaining({
        key: guidePairKey("Abha", "Al Ettifaq"),
        channel: "ثمانية 2",
        broadcast: expect.objectContaining({
          channelId: "thmanyah-2",
          source: "livefootballtv",
          confidence: "exact",
        }),
      }),
      expect.objectContaining({
        key: guidePairKey("Al Shabab", "Al Hilal"),
        channel: "ثمانية 1",
      }),
      expect.objectContaining({
        key: guidePairKey("Al Ahli", "Al Riyadh"),
        channel: "ثمانية 3",
      }),
    ]);
  });

  it("ignores generic network/app listings until a numbered channel is published", () => {
    const html = guideCell("Neom SC - Al Khaleej", ["Thmanyah Channels", "Thmanyah App"]);
    expect(parseSaudiTvGuide(html)).toEqual([]);
  });
});

describe("Saudi TV guide overlay", () => {
  it("upgrades the rights-holder fallback to the exact channel and clears stale beIN playback routing", () => {
    const matches = [
      {
        id: "espn-ksa.1-401900371",
        home: "Abha",
        away: "Al Ettifaq",
        channel: "ثمانية",
        channelId: "bein-sports-1",
        broadcast: {
          provider: "thmanyah",
          channelId: "thmanyah",
          source: "spl-rights-holder",
          confidence: "network",
        },
      },
    ];
    const commentaryIndex = [
      {
        key: "abha~alettifaq",
        home: "Abha",
        away: "Al Ettifaq",
        channel: "ثمانية",
        channelId: "bein-sports-1",
        commentators: [],
      },
    ];
    const guideRows = parseSaudiTvGuide(
      guideCell("Abha Club - Al Ettifaq", ["Thmanyah Channels", "Thmanyah 2 HD"]),
    );

    expect(applySaudiTvGuide(matches, commentaryIndex, guideRows)).toBe(1);
    expect(matches[0]).toMatchObject({
      channel: "ثمانية 2",
      broadcast: {
        provider: "thmanyah",
        channelId: "thmanyah-2",
        source: "livefootballtv",
        confidence: "exact",
      },
    });
    expect(matches[0].channelId).toBeUndefined();
    expect(commentaryIndex[0].channel).toBe("ثمانية 2");
    expect(commentaryIndex[0].channelId).toBeUndefined();
  });
});
