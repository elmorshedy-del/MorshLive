import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { TeamNames } = require("../assets/js/team-names.js");
const { shouldIncludeAudienceMatch } = require("../scripts/matches-lib.js");

const EUROPE_SURFACE_TEAMS = [
  "Austria",
  "Belgium",
  "Bulgaria",
  "Croatia",
  "Cyprus",
  "Czechia",
  "Denmark",
  "France",
  "Germany",
  "Greece",
  "Hungary",
  "Ireland",
  "Italy",
  "Netherlands",
  "Poland",
  "Portugal",
  "Slovenia",
  "Spain",
  "Sweden",
  "England",
  "Scotland",
  "Wales",
  "Northern Ireland",
  "Norway",
];

const EUROPE_NON_TRIGGER_TEAMS = [
  "Estonia",
  "Finland",
  "Latvia",
  "Lithuania",
  "Luxembourg",
  "Malta",
  "Romania",
  "Slovakia",
];

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
    expect(TeamNames.isHiddenNationalTeam("Israel")).toBe(true);
    expect(TeamNames.isHiddenNationalTeam("Brazil")).toBe(false);
  });

  it("defines the European surface trigger set through canonical national-team metadata", () => {
    for (const team of EUROPE_SURFACE_TEAMS) {
      expect(TeamNames.isInAudienceGroup(team, "europe_surface"), team).toBe(true);
    }

    for (const team of [
      ...EUROPE_NON_TRIGGER_TEAMS,
      "Albania",
      "Armenia",
      "Iceland",
      "Serbia",
      "Switzerland",
      "Türkiye",
      "Ukraine",
    ]) {
      expect(TeamNames.isInAudienceGroup(team, "europe_surface"), team).toBe(false);
    }
    expect(TeamNames.isInAudienceGroup("Republic of Ireland", "europe_surface")).toBe(true);
    expect(TeamNames.isInAudienceGroup("Czech Republic", "europe_surface")).toBe(true);
  });

  it("keeps static Arabic data complete for European trigger and opponent teams", () => {
    const staticArabic = JSON.parse(readFileSync("assets/data/team-names-ar.json", "utf8"));
    for (const team of [...EUROPE_SURFACE_TEAMS, ...EUROPE_NON_TRIGGER_TEAMS]) {
      expect(staticArabic[team], team).toBeTruthy();
    }
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
  it("filters Israel out across international competitions before audience rules", () => {
    expect(shouldIncludeAudienceMatch({ competition: "unl", home: "Austria", away: "Israel" })).toBe(false);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Israel", away: "France" })).toBe(
      false,
    );
    expect(shouldIncludeAudienceMatch({ competition: "unl", home: "Austria", away: "Ireland" })).toBe(true);
  });

  it("surfaces European national-team matches when either side is in the trigger set", () => {
    const competitions = ["unl", "euro", "euroq", "uefawcq"];
    const included = [
      ["Germany", "Cyprus"],
      ["Cyprus", "Germany"],
      ["Bulgaria", "Luxembourg"],
      ["Germany", "Estonia"],
      ["Germany", "Bulgaria"],
      ["Norway", "Iceland"],
      ["Scotland", "Serbia"],
      ["Wales", "Switzerland"],
      ["Northern Ireland", "Türkiye"],
      ["Czech Republic", "Albania"],
      ["France", "Romania"],
      ["England", "Slovakia"],
    ];
    const excluded = [
      ["Estonia", "Iceland"],
      ["Finland", "Belarus"],
      ["Latvia", "Kazakhstan"],
      ["Lithuania", "Azerbaijan"],
      ["Luxembourg", "Iceland"],
      ["Malta", "Liechtenstein"],
      ["Romania", "Serbia"],
      ["Slovakia", "Kazakhstan"],
      ["Albania", "Armenia"],
      ["Switzerland", "Serbia"],
      ["Ukraine", "Georgia"],
    ];

    for (const competition of competitions) {
      for (const [home, away] of included) {
        expect(
          shouldIncludeAudienceMatch({ competition, home, away }),
          `${competition}: ${home} v ${away}`,
        ).toBe(true);
      }
      for (const [home, away] of excluded) {
        expect(
          shouldIncludeAudienceMatch({ competition, home, away }),
          `${competition}: ${home} v ${away}`,
        ).toBe(false);
      }
    }
  });

  it("keeps AFCON qualifiers only when a North African team is involved", () => {
    expect(shouldIncludeAudienceMatch({ competition: "afconq", home: "Egypt", away: "Angola" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "afconq", home: "Morocco", away: "Gabon" })).toBe(true);
    expect(shouldIncludeAudienceMatch({ competition: "afconq", home: "Nigeria", away: "Ghana" })).toBe(false);
  });

  it("keeps international friendlies involving GCC, North Africa, Europe triggers, Brazil, or Argentina", () => {
    const included = [
      ["Brazil", "Australia"],
      ["Argentina", "Bolivia"],
      ["Saudi Arabia", "Kuwait"],
      ["UAE", "Japan"],
      ["Egypt", "Jordan"],
      ["England", "United States"],
      ["France", "Senegal"],
      ["Spain", "Mexico"],
      ["Germany", "Japan"],
      ["Italy", "Uruguay"],
      ["Portugal", "Canada"],
      ["Netherlands", "Colombia"],
      ["Belgium", "South Korea"],
      ["Croatia", "Australia"],
      ["Norway", "Japan"],
      ["Sweden", "Mexico"],
      ["Scotland", "Canada"],
      ["Republic of Ireland", "Colombia"],
      ["Germany", "Estonia"],
      ["England", "Romania"],
    ];

    for (const [home, away] of included) {
      expect(shouldIncludeAudienceMatch({ competition: "friendly", home, away })).toBe(true);
    }

    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Japan", away: "Uruguay" })).toBe(
      false,
    );
    expect(
      shouldIncludeAudienceMatch({ competition: "friendly", home: "Albania", away: "Switzerland" }),
    ).toBe(false);
    expect(shouldIncludeAudienceMatch({ competition: "friendly", home: "Romania", away: "Serbia" })).toBe(
      false,
    );
    expect(
      shouldIncludeAudienceMatch({ competition: "friendly", home: "Slovakia", away: "Kazakhstan" }),
    ).toBe(false);
  });

  it("keeps CONMEBOL World Cup qualifiers only for Brazil or Argentina", () => {
    for (const [home, away] of [
      ["Brazil", "Bolivia"],
      ["Argentina", "Ecuador"],
    ]) {
      expect(shouldIncludeAudienceMatch({ competition: "conmebolq", home, away })).toBe(true);
    }

    expect(shouldIncludeAudienceMatch({ competition: "conmebolq", home: "Uruguay", away: "Colombia" })).toBe(
      false,
    );
  });

  it("does not filter normal club competitions", () => {
    expect(shouldIncludeAudienceMatch({ competition: "epl", home: "Arsenal", away: "Liverpool" })).toBe(true);
  });
});
