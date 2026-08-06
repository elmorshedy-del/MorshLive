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

  it("parses titles ending with في كأس العالم", () => {
    expect(titleTeams("ملخص مباراة اسبانيا والراس الاخضر في كأس العالم")).toEqual({
      a: "اسبانيا",
      b: "الراس الاخضر",
    });
  });
});
