import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// team-names.js is a browser IIFE that assigns global.TeamNames. Eval it in a
// sandbox with a `window` global so we can unit-test the canonical-key logic
// that the highlight/goal/moment/meme joins depend on — no bundler needed.
const src = readFileSync(fileURLToPath(new URL("../assets/js/team-names.js", import.meta.url)), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(src, sandbox);
const TeamNames = sandbox.window.TeamNames;

describe("TeamNames.canonicalToken", () => {
  it("collapses English name variants to one identity", () => {
    expect(TeamNames.canonicalToken("USA")).toBe(TeamNames.canonicalToken("United States"));
    expect(TeamNames.canonicalToken("Korea Republic")).toBe(TeamNames.canonicalToken("South Korea"));
    expect(TeamNames.canonicalToken("Türkiye")).toBe(TeamNames.canonicalToken("Turkey"));
    expect(TeamNames.canonicalToken("Cote d'Ivoire")).toBe(TeamNames.canonicalToken("Ivory Coast"));
  });

  it("collapses an already-normalized token too (as stored keys arrive)", () => {
    expect(TeamNames.canonicalToken("unitedstates")).toBe(TeamNames.canonicalToken("USA"));
  });

  it("falls back to normalized English for unknown teams (no regression)", () => {
    expect(TeamNames.canonicalToken("Curacao")).toBe("curacao");
    expect(TeamNames.canonicalToken("Curacao")).toBe(TeamNames.canonicalToken("curaçao"));
  });
});

describe("stored key <-> live lookup key agreement", () => {
  it("a stored variant key canonicalizes to the live lookup key", () => {
    // stored (from the fetch pipeline, English-canonical)
    const stored = TeamNames.canonicalizeKey("belgium~unitedstates");
    // live feed returning the "USA" variant
    const live = TeamNames.canonicalKey("Belgium", "USA");
    expect(stored).toBe(live);
  });

  it("is order-independent (home/away swapped still matches)", () => {
    expect(TeamNames.canonicalKey("USA", "Belgium")).toBe(TeamNames.canonicalKey("Belgium", "United States"));
  });

  it("keeps distinct matches distinct", () => {
    expect(TeamNames.canonicalKey("Brazil", "Norway")).not.toBe(TeamNames.canonicalKey("Brazil", "Morocco"));
  });
});
