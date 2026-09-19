import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { FOOTBALL_LEAGUES } from "../backend/services/football.js";

const require = createRequire(import.meta.url);
const { COMPETITIONS, ESPN_LEAGUES } = require("../scripts/matches-lib.js");

function comparableCompetition(competition) {
  return {
    key: competition.key,
    nameAr: competition.nameAr,
    espnSlugs: [...competition.espnSlugs],
    leagueNames: [...competition.leagueNames],
    teamWhitelist: [...(competition.teamWhitelist || [])],
    audienceGroups: [...(competition.audienceGroups || [])],
  };
}

function loadBrowserCompetitionConfig() {
  const marker = "  const ESPN_LEAGUES = COMPETITIONS.flatMap((competition) => competition.espnSlugs);";
  let source = readFileSync("assets/js/matches-api.js", "utf8");
  if (!source.includes(marker)) {
    throw new Error(
      "matches-api.js competition registry shape changed; update this parity test before merging",
    );
  }

  source = source.replace(marker, `  global.__KZ_TEST_COMPETITIONS__ = COMPETITIONS;\n${marker}`);

  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "assets/js/matches-api.js" });
  return sandbox.window.__KZ_TEST_COMPETITIONS__;
}

describe("football competition registry parity", () => {
  it("keeps browser and Node competition metadata exactly aligned", () => {
    const browserCompetitions = loadBrowserCompetitionConfig();
    expect(browserCompetitions.map(comparableCompetition)).toEqual(COMPETITIONS.map(comparableCompetition));
  });

  it("keeps the backend ESPN allowlist exactly aligned with the shared Node registry", () => {
    expect(FOOTBALL_LEAGUES).toEqual(ESPN_LEAGUES);
  });

  it("keeps competition keys, ESPN slugs, and league aliases unambiguous", () => {
    const keys = COMPETITIONS.map((competition) => competition.key);
    const slugs = COMPETITIONS.flatMap((competition) => competition.espnSlugs);
    const aliases = COMPETITIONS.flatMap((competition) =>
      competition.leagueNames.map((name) => name.trim().toLowerCase()),
    );

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(aliases).size).toBe(aliases.length);
  });
});
