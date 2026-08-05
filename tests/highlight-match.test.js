import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { titleTeams } = require("../scripts/lib/highlight-match-lib.js");

describe("titleTeams", () => {
  it("parses vortex-style titles with inline scores", () => {
    expect(titleTeams("ملخص مباراة مصر وايران 1 1 كأس العالم")).toEqual({
      a: "مصر",
      b: "ايران",
    });
  });

  it("parses parenthetical scores before نهائي", () => {
    expect(titleTeams("ملخص مباراة اسبانيا والارجنتين (1-0) نهائي كأس العالم 2026")).toEqual({
      a: "اسبانيا",
      b: "الارجنتين",
    });
  });
});
