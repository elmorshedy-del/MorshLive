import { describe, expect, it } from "vitest";
import {
  isAllowedArabicWrapperUrl,
  isForbiddenStreamUrl,
  nextBindCheck,
  parseAlbaWrapper,
  productionPlanIsLive,
  wrapperSlotChanged,
} from "../lib/bind-loop.js";

const SPORT2 = `<title>sport 2</title>
<iframe src="https://912acsss8af382.fabortvcdn.com/playerv5.php?match=4750898&key=abc"></iframe>`;

describe("parseAlbaWrapper", () => {
  it("reads the inner Fabor match id and iframe", () => {
    expect(parseAlbaWrapper(SPORT2)).toEqual({
      title: "sport 2",
      faborId: "4750898",
      iframeSrc: "https://912acsss8af382.fabortvcdn.com/playerv5.php?match=4750898&key=abc",
    });
  });

  it("treats a missing iframe as empty, not as a bindable slot", () => {
    expect(parseAlbaWrapper("<title>sport 3</title>").iframeSrc).toBe("");
    expect(parseAlbaWrapper("<title>sport 3</title>").faborId).toBe("");
  });
});

describe("wrapperSlotChanged", () => {
  it("flags a Fabor id swap as slot reuse", () => {
    expect(
      wrapperSlotChanged(parseAlbaWrapper(SPORT2), parseAlbaWrapper(SPORT2.replace("4750898", "4760001"))),
    ).toBe(true);
    expect(wrapperSlotChanged(parseAlbaWrapper(SPORT2), parseAlbaWrapper(SPORT2))).toBe(false);
  });
});

describe("stream URL policy", () => {
  it("rejects the sources that failed Saturday and Sunday", () => {
    expect(isForbiddenStreamUrl("https://reddit-soccer-streams.online/frame.php?ch=b2")).toBe(true);
    expect(isForbiddenStreamUrl("https://iframe.st/games/elche-vs-barcelona/")).toBe(true);
    expect(isForbiddenStreamUrl("https://kora-plus.li/frame.php?ch=b1")).toBe(true);
    expect(isForbiddenStreamUrl("https://go4score.mov/?m=31110")).toBe(true);
    expect(isAllowedArabicWrapperUrl("https://mo.yallacuo.xyz/albaplayer/sport-2/")).toBe(true);
    expect(isAllowedArabicWrapperUrl("https://pl.koralive1.cc/albaplayer/bein2/")).toBe(true);
    expect(isAllowedArabicWrapperUrl("https://reddit-soccer-streams.online/frame.php?ch=b2")).toBe(false);
  });
});

describe("productionPlanIsLive", () => {
  it("rejects the no-catalog-legacy koraplus response that showed nothing", () => {
    expect(
      productionPlanIsLive(
        {
          matchId: "espn-esp.1-401882913",
          catalog: false,
          reason: "no-catalog-legacy",
          status: "legacy",
          selected: { playbackUrl: "/wk/albaplayer/koraplus/?ch=bein-sports-2" },
        },
        { matchId: "espn-esp.1-401882913", urlIncludes: "yallacuo.xyz/albaplayer/sport-2" },
      ),
    ).toBe(false);
  });

  it("accepts only the catalog row for that match on an allowed wrapper", () => {
    expect(
      productionPlanIsLive(
        {
          matchId: "espn-esp.1-401882913",
          catalog: true,
          reason: "selected:primary",
          status: "verified",
          selected: { playbackUrl: "https://mo.yallacuo.xyz/albaplayer/sport-2/" },
        },
        { matchId: "espn-esp.1-401882913", urlIncludes: "yallacuo.xyz/albaplayer/sport-2" },
      ),
    ).toBe(true);
  });
});

describe("nextBindCheck", () => {
  it("does not sit in a T-15 tour when the scorebug is not up yet", () => {
    expect(nextBindCheck({ foundScorebug: false, minutesToKickoff: 15 })).toBe("arm-kickoff");
    expect(nextBindCheck({ foundScorebug: true, minutesToKickoff: 1 })).toBe("bind");
    expect(nextBindCheck({ foundScorebug: false, minutesToKickoff: 0 })).toBe("bind-or-skip");
  });
});
