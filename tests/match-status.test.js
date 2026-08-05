import { describe, expect, it } from "vitest";
import {
  demoteStaleLive,
  kickoffInferStatus,
  MAX_LIVE_INFER_MS,
  refineCachedStatus,
} from "../lib/match-status.js";

const NOW = Date.parse("2026-08-05T12:00:00Z");

describe("kickoffInferStatus", () => {
  it("returns upcoming before kickoff", () => {
    expect(kickoffInferStatus("2026-08-05T18:00:00Z", "upcoming", NOW)).toBe("upcoming");
  });

  it("returns live shortly after kickoff", () => {
    expect(kickoffInferStatus("2026-08-05T11:00:00Z", "upcoming", NOW)).toBe("live");
  });

  it("returns ended when kickoff is far in the past", () => {
    expect(kickoffInferStatus("2026-07-07T20:00:00Z", "upcoming", NOW)).toBe("ended");
  });

  it("caps live inference at MAX_LIVE_INFER_MS", () => {
    const kickoff = NOW - MAX_LIVE_INFER_MS - 1;
    expect(kickoffInferStatus(kickoff, "upcoming", NOW)).toBe("ended");
    expect(kickoffInferStatus(kickoff + 1, "upcoming", NOW)).toBe("live");
  });
});

describe("demoteStaleLive", () => {
  it("keeps live within the inference window", () => {
    expect(demoteStaleLive("live", NOW - 60 * 60 * 1000, NOW)).toBe("live");
  });

  it("demotes stale World Cup cache rows to ended", () => {
    expect(demoteStaleLive("live", "2026-07-07T20:00:00Z", NOW)).toBe("ended");
  });

  it("does not touch ended or upcoming", () => {
    expect(demoteStaleLive("ended", "2026-07-07T20:00:00Z", NOW)).toBe("ended");
    expect(demoteStaleLive("upcoming", "2026-08-06T12:00:00Z", NOW)).toBe("upcoming");
  });
});

describe("refineCachedStatus", () => {
  it("demotes stale cached live and infers upcoming/live otherwise", () => {
    expect(refineCachedStatus("live", "2026-07-07T20:00:00Z", NOW)).toBe("ended");
    expect(refineCachedStatus("upcoming", "2026-08-05T18:00:00Z", NOW)).toBe("upcoming");
    expect(refineCachedStatus("upcoming", "2026-08-05T11:00:00Z", NOW)).toBe("live");
  });
});
