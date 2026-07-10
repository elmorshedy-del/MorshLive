import { describe, expect, it } from "vitest";
import { arabiaDayIso, arabiaTodayIso } from "../scripts/matches-lib.js";

describe("arabiaDayIso", () => {
  it("keeps a daytime UTC kickoff on the same MENA day", () => {
    expect(arabiaDayIso("2026-07-09T12:00:00Z")).toBe("2026-07-09");
  });

  it("rolls a late-night UTC kickoff onto the correct MENA day", () => {
    // 22:00 UTC = 01:00 next day in Gulf time — used to be bucketed under 07-09.
    expect(arabiaDayIso("2026-07-09T22:00:00Z")).toBe("2026-07-10");
  });

  it("returns empty for missing/invalid kickoff", () => {
    expect(arabiaDayIso("")).toBe("");
    expect(arabiaDayIso(null)).toBe("");
    expect(arabiaDayIso("not-a-date")).toBe("");
  });
});

describe("arabiaTodayIso", () => {
  it("uses MENA time for 'today' across the UTC midnight boundary", () => {
    expect(arabiaTodayIso(Date.parse("2026-07-09T12:00:00Z"))).toBe("2026-07-09");
    // 22:30 UTC is already the next day in MENA
    expect(arabiaTodayIso(Date.parse("2026-07-09T22:30:00Z"))).toBe("2026-07-10");
  });
});
