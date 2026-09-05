import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BINDING_CONTESTED,
  BINDING_FALLBACK,
  BINDING_RESOLVED,
  bindingConfidence,
  isTrustedBinding,
  markContestedBindings,
} from "../lib/channel-binding.js";

function match(overrides) {
  return { home: "A", away: "B", kickoffUtc: "2026-08-26T19:00Z", ...overrides };
}

describe("bindingConfidence", () => {
  it("trusts an explicitly resolved binding", () => {
    expect(bindingConfidence(match({ channelId: "bein-max-3", channelBinding: "resolved" }))).toBe(
      BINDING_RESOLVED,
    );
    expect(isTrustedBinding(match({ channelId: "bein-max-3", channelBinding: "resolved" }))).toBe(true);
  });

  it("treats a bare default channel as a guess, not a fact", () => {
    // This is what every match in production looked like: channelId set to the
    // fallback with nothing to say it was ever verified.
    expect(bindingConfidence(match({ channelId: "bein-sports-1" }))).toBe(BINDING_FALLBACK);
    expect(isTrustedBinding(match({ channelId: "bein-sports-1" }))).toBe(false);
  });

  it("trusts a non-default channel on an unannotated payload", () => {
    expect(bindingConfidence(match({ channelId: "bein-max-2" }))).toBe(BINDING_RESOLVED);
  });

  it("treats a missing channel as a fallback", () => {
    expect(bindingConfidence(match({}))).toBe(BINDING_FALLBACK);
    expect(bindingConfidence(null)).toBe(BINDING_FALLBACK);
  });
});

describe("markContestedBindings", () => {
  it("flags the real production clash: five matches on one channel at 19:00", () => {
    const rows = [
      match({ home: "Real Madrid", away: "Real Sociedad", channelId: "bein-sports-1" }),
      match({ home: "AEK Athens", away: "Levski Sofia", channelId: "bein-sports-1" }),
      match({ home: "Lyon", away: "Fenerbahce", channelId: "bein-sports-1" }),
      match({ home: "NK Celje", away: "Slovan", channelId: "bein-sports-1" }),
      match({ home: "Viking FK", away: "Dinamo Zagreb", channelId: "bein-sports-1" }),
    ];
    markContestedBindings(rows);
    for (const row of rows) {
      expect(bindingConfidence(row), `${row.home} should be contested`).toBe(BINDING_CONTESTED);
    }
  });

  it("leaves a channel with one match at that time alone", () => {
    const rows = [
      match({ home: "Real Madrid", away: "Real Sociedad", channelId: "bein-sports-1" }),
      match({
        home: "Later",
        away: "Game",
        channelId: "bein-sports-1",
        kickoffUtc: "2026-08-26T22:00Z",
      }),
    ];
    markContestedBindings(rows);
    expect(rows.every((row) => row.channelBinding !== BINDING_CONTESTED)).toBe(true);
  });

  it("keeps different channels independent", () => {
    const rows = [
      match({ channelId: "bein-sports-1" }),
      match({ channelId: "bein-max-2", channelBinding: "resolved" }),
    ];
    markContestedBindings(rows);
    expect(rows[0].channelBinding).not.toBe(BINDING_CONTESTED);
    expect(rows[1].channelBinding).toBe(BINDING_RESOLVED);
  });

  it("does not demote a binding the registry actually resolved", () => {
    // If the registry named the same channel for both, the clash is upstream
    // reality rather than our guesswork, and overriding it would lose real data.
    const rows = [
      match({ home: "A", away: "B", channelId: "bein-max-1", channelBinding: "resolved" }),
      match({ home: "C", away: "D", channelId: "bein-max-1", channelBinding: "resolved" }),
    ];
    markContestedBindings(rows);
    expect(rows.every((row) => row.channelBinding === BINDING_RESOLVED)).toBe(true);
  });

  it("survives matches with no kickoff time", () => {
    const rows = [
      match({ channelId: "bein-sports-1", kickoffUtc: null }),
      match({ channelId: "bein-sports-1" }),
    ];
    expect(() => markContestedBindings(rows)).not.toThrow();
  });
});

describe("binding levels stay in sync with their consumers", () => {
  // scripts/ is CommonJS and the browser has no bundler, so the three level
  // names are repeated in both. Fail loudly if a rename lands in only one.
  const consumers = ["scripts/commentators-lib.js", "assets/js/watch.js"];

  it("uses the same level names everywhere", () => {
    for (const file of consumers) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(source, `${file} should know "${BINDING_FALLBACK}"`).toContain(BINDING_FALLBACK);
      expect(source, `${file} should know "${BINDING_CONTESTED}"`).toContain(BINDING_CONTESTED);
      expect(source, `${file} should know "${BINDING_RESOLVED}"`).toContain(BINDING_RESOLVED);
    }
  });
});
