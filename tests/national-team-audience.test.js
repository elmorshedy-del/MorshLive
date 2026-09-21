import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { TeamNames } = require("../assets/js/team-names.js");
const { shouldIncludeAudienceMatch } = require("../scripts/matches-lib.js");

describe("national-team registry", () => {
  it("resolves aliases to one canonical team with Arabic localization and audience groups", () => {
    expect(TeamNames.resolveNationalTeam("UAE")).toMatchObject({
      name: "United Arab Emirates",
      ar: "الإمارات",
      groups: ["gcc"],
    });
    expect(TeamNames.resolveNationalTeam("United Arab Emirates")?.name).toBe("United Arab Emirates");
    expect(TeamNames.arabicFor("UAE")).toBe("الإمارات");
    expect(TeamNames.isInAudienceGroup("UAE", "gcc")).toBe(true);
    expect(TeamNames.isInAudienceGroup("United Arab Emirates", "gcc")).toBe(true);
    expect(TeamNames.arabicFor("Albania")).toBe("ألبانيا");
    expect(TeamNames.arabicFor("Libya")).toBe("ليبيا");
  });

  it("localizes international opponent countries even when they are not audience-filter teams", () => {
    expect(TeamNames.arabicFor("Uganda")).toBe("أوغندا");
    expect(TeamNames.arabicFor("Botswana")).toBe("بوتسوانا");
    expect(TeamNames.arabicFor("Angola")).toBe("أنغولا");
    expect(TeamNames.arabicFor("Gabon")).toBe("الغابون");
    expect(TeamNames.arabicFor("UAE")).toBe("الإمارات");
    expect(TeamNames.arabicFor("Bolivia")).toBe("بوليفيا");
    expect(TeamNames.arabicFor("Venezuela")).toBe("فنزويلا");
  });
});

describe("international audience filtering", () => {
  it("keeps all UEFA Nations League matches", () => {
    expect(shouldIncludeAudienceMatch({ competition: "unl", home: "Albania", away: "Armenia" })).toBe(true);
  });

  it("keeps AFCON qualifiers only when a North African team is involved", () => {
    expect(shouldIncludeAudienceMatch({ competition: "afconq", home: "Egypt", away: "Angola" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "afconq", home: "Morocco", away: "Gabon" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "afconq", home: "Nigeria", away: "Ghana" })).toBe(false);
  });

  it("keeps international friendlies involving GCC, North Africa, priority Europe, Brazil, or Argentina", () => {
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Brazil", away: "Australia" })).toBe(
      true,
    );
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Argentina", away: "Bolivia" })).toBe(
      true,
    );
    expect(
      shouldIncludeAudienceMatch({ competition: "friendly", home: "Saudi Arabia", away: "Kuwait" }),
    ).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "UAE", away: "Japan" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Egypt", away: "Jordan" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "England", away: "United States" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "France", away: "Senegal" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Spain", away: "Mexico" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Germany", away: "Japan" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Italy", away: "Uruguay" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Portugal", away: "Canada" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Netherlands", away: "Colombia" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Belgium", away: "South Korea" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Croatia", away: "Australia" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Japan", away: "Uruguay" })).toBe(
      false,
    );
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Norway", away: "Sweden" })).toBe(false);
  });

  it("keeps CONMEBOL World Cup qualifiers only for Brazil or Argentina", () => {
    expect(shouldIncludeAudienceMatch({ competition: "conmebolq", home: "Brazil", away: "Bolivia" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "conmebolq", home: "Argentina", away: "Ecuador" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "conmebolq", home: "Uruguay", away: "Colombia" })).toBe(false);
  });

  it("does not filter normal club competitions", () => {
    expect(shouldIncludeAudienceMatch({ competition: "epl", home: "Arsenal", away: "Liverpool" })).toBe(true);
  });
});
