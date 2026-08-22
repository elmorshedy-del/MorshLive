import { describe, expect, it } from "vitest";
import {
  applyConflicts,
  applyVerificationResult,
  buildLegacyPlan,
  contentKeyForMatch,
  findCatalogPlan,
  iframePolicyForProfile,
  liveContentConflicts,
  matchPlanKey,
  normalizePlan,
  playbackUrlForSource,
  resolveStreamPlan,
  selectPlayableSource,
  shouldHoldPlayer,
} from "../lib/stream-plan.js";

const NOW = Date.parse("2026-08-22T18:00:00Z");

const liverpoolArsenal = {
  id: "espn-eng.1-401111111",
  home: "Liverpool",
  away: "Arsenal",
  channelId: "bein-sports-1",
  status: "live",
  kickoffUtc: "2026-08-22T19:00:00Z",
};

const realBarca = {
  id: "espn-esp.1-401222222",
  home: "Real Madrid",
  away: "Barcelona",
  channelId: "bein-sports-2",
  status: "live",
  kickoffUtc: "2026-08-22T19:00:00Z",
};

function catalog(plans) {
  return { version: 1, plans };
}

function operatorPlan(overrides = {}) {
  return {
    matchId: liverpoolArsenal.id,
    teams: ["liverpool", "arsenal"],
    contentKey: "bein-sports-1",
    policy: { sameContentOnly: true, allowLegacy: false, allowUnverifiedFallback: false },
    sources: [
      {
        id: "primary",
        role: "primary",
        kind: "iframe",
        profile: "operator-iframe-v1",
        url: "https://example.test/embed/bein1",
        contentKey: "bein-sports-1",
        status: "operator",
      },
    ],
    ...overrides,
  };
}

describe("match identity", () => {
  it("builds a stable order-independent plan key", () => {
    expect(matchPlanKey("Liverpool", "Arsenal")).toBe(matchPlanKey("Arsenal", "Liverpool"));
  });

  it("uses an explicit content key before the channel fallback", () => {
    expect(contentKeyForMatch({ contentKey: "bein-sports-1", channelId: "bein-max-1" })).toBe("bein-sports-1");
    expect(contentKeyForMatch(liverpoolArsenal)).toBe("channel:bein-sports-1");
  });
});

describe("catalog lookup", () => {
  it("finds a plan by match id first", () => {
    const found = findCatalogPlan(
      catalog([
        { matchId: liverpoolArsenal.id, contentKey: "bein-sports-1" },
        { teams: ["liverpool", "arsenal"], contentKey: "wrong" },
      ]),
      liverpoolArsenal,
    );
    expect(found.contentKey).toBe("bein-sports-1");
  });

  it("falls back to team aliases when the ESPN id is missing from the file", () => {
    const found = findCatalogPlan(
      catalog([{ teams: [["liverpool", "lfc"], "arsenal"], contentKey: "bein-sports-1" }]),
      { ...liverpoolArsenal, id: "other-id" },
    );
    expect(found.contentKey).toBe("bein-sports-1");
  });
});

describe("source selection", () => {
  it("never selects a source whose content key differs from the plan", () => {
    const plan = normalizePlan(
      operatorPlan({
        sources: [
          {
            id: "wrong-game",
            role: "primary",
            kind: "iframe",
            url: "https://example.test/other",
            contentKey: "bein-sports-2",
            status: "verified",
          },
        ],
      }),
      liverpoolArsenal,
      NOW,
    );
    expect(selectPlayableSource(plan, { now: NOW })).toBeNull();
  });

  it("prefers verified over operator over pending", () => {
    const plan = normalizePlan(
      operatorPlan({
        policy: { sameContentOnly: true, allowUnverifiedFallback: true },
        sources: [
          {
            id: "pending",
            role: "primary",
            kind: "iframe",
            url: "https://example.test/pending",
            contentKey: "bein-sports-1",
            status: "pending",
          },
          {
            id: "operator",
            role: "alternate",
            kind: "iframe",
            url: "https://example.test/operator",
            contentKey: "bein-sports-1",
            status: "operator",
          },
          {
            id: "verified",
            role: "alternate",
            kind: "hls",
            profile: "operator-hls-v1",
            url: "https://example.test/live.m3u8",
            contentKey: "bein-sports-1",
            status: "verified",
          },
        ],
      }),
      liverpoolArsenal,
      NOW,
    );
    expect(selectPlayableSource(plan, { now: NOW }).id).toBe("verified");
  });

  it("does not use pending sources unless the plan allows unverified fallback", () => {
    const plan = normalizePlan(
      operatorPlan({
        sources: [
          {
            id: "pending",
            role: "primary",
            kind: "iframe",
            url: "https://example.test/pending",
            contentKey: "bein-sports-1",
            status: "pending",
          },
        ],
      }),
      liverpoolArsenal,
      NOW,
    );
    expect(selectPlayableSource(plan, { now: NOW })).toBeNull();
    expect(selectPlayableSource(plan, { now: NOW, allowUnverified: true }).id).toBe("pending");
  });

  it("demotes an expired verified source to pending", () => {
    const plan = normalizePlan(
      operatorPlan({
        sources: [
          {
            id: "stale",
            role: "primary",
            kind: "iframe",
            url: "https://example.test/stale",
            contentKey: "bein-sports-1",
            status: "verified",
            expiresAt: "2026-08-22T17:00:00Z",
          },
        ],
      }),
      liverpoolArsenal,
      NOW,
    );
    expect(selectPlayableSource(plan, { now: NOW })).toBeNull();
  });

  it("never treats a failed source as a same-content fallback", () => {
    const plan = normalizePlan(
      operatorPlan({
        policy: { sameContentOnly: true, allowUnverifiedFallback: true },
        sources: [
          {
            id: "dead",
            role: "primary",
            kind: "iframe",
            url: "https://example.test/dead",
            contentKey: "bein-sports-1",
            status: "failed",
          },
        ],
      }),
      liverpoolArsenal,
      NOW,
    );
    expect(selectPlayableSource(plan, { now: NOW })).toBeNull();
  });
});

describe("resolveStreamPlan", () => {
  it("holds the player when a catalog plan has no playable same-content source", () => {
    const resolved = resolveStreamPlan({
      match: liverpoolArsenal,
      catalog: catalog([operatorPlan({ sources: [] })]),
      now: NOW,
    });
    expect(resolved.status).toBe("waiting");
    expect(resolved.selected).toBeNull();
    expect(shouldHoldPlayer(resolved)).toBe(true);
    expect(resolved.reason).toBe("no-playable-same-content-source");
  });

  it("returns the operator source instead of the generic legacy embed", () => {
    const resolved = resolveStreamPlan({
      match: liverpoolArsenal,
      catalog: catalog([operatorPlan()]),
      legacyEmbedKey: "koraplus",
      now: NOW,
    });
    expect(resolved.status).toBe("operator");
    expect(resolved.selected.url).toBe("https://example.test/embed/bein1");
    expect(resolved.profile.noSandbox).toBe(true);
    expect(resolved.profile.referrerPolicy).toBe("no-referrer");
    expect(resolved.policy.allowAutoHeal).toBe(false);
  });

  it("falls back to a pending legacy plan when no catalog row exists", () => {
    const resolved = resolveStreamPlan({
      match: liverpoolArsenal,
      catalog: catalog([]),
      legacyEmbedKey: "koraplus",
      now: NOW,
    });
    expect(resolved.status).toBe("legacy");
    expect(resolved.selected.path).toBe("/wk/albaplayer/koraplus/");
    expect(resolved.catalog).toBe(false);
    expect(shouldHoldPlayer(resolved)).toBe(false);
  });

  it("waits instead of guessing when the match is not known yet", () => {
    const resolved = resolveStreamPlan({ match: null, catalog: catalog([]), now: NOW });
    expect(resolved.status).toBe("waiting");
    expect(resolved.reason).toBe("missing-match");
    expect(shouldHoldPlayer(resolved)).toBe(true);
  });
});

describe("conflicts and verification", () => {
  it("blocks catalog plans that share one live content key", () => {
    const plans = catalog([
      operatorPlan(),
      operatorPlan({
        matchId: realBarca.id,
        teams: ["real madrid", "barcelona"],
        contentKey: "bein-sports-1",
        sources: [
          {
            id: "primary",
            role: "primary",
            kind: "iframe",
            url: "https://example.test/embed/bein1",
            contentKey: "bein-sports-1",
            status: "verified",
          },
        ],
      }),
    ]);
    const conflicts = liveContentConflicts([liverpoolArsenal, realBarca], plans, NOW);
    expect(conflicts).toEqual([
      { contentKey: "bein-sports-1", matchIds: [liverpoolArsenal.id, realBarca.id] },
    ]);
    const resolved = applyConflicts(
      resolveStreamPlan({ match: liverpoolArsenal, catalog: plans, now: NOW }),
      conflicts,
    );
    expect(resolved.status).toBe("conflict");
    expect(resolved.selected).toBeNull();
    expect(shouldHoldPlayer(resolved)).toBe(true);
  });

  it("does not hold two legacy matches that merely share the default channel key", () => {
    const conflicts = liveContentConflicts(
      [
        liverpoolArsenal,
        { ...realBarca, channelId: "bein-sports-1" },
      ],
      catalog([]),
      NOW,
    );
    expect(conflicts).toEqual([]);
  });

  it("promotes a primary source after a successful probe", () => {
    const updated = applyVerificationResult(operatorPlan(), { ok: true, sourceId: "primary" }, NOW);
    expect(updated.status).toBe("verified");
    expect(updated.sources[0].status).toBe("verified");
  });
});

describe("provider profiles", () => {
  it("keeps koraplus and operator embeds unsandboxed", () => {
    expect(iframePolicyForProfile("koraplus-v1").noSandbox).toBe(true);
    expect(iframePolicyForProfile("operator-iframe-v1").sandbox).toBe("");
    expect(iframePolicyForProfile("sirtv-v1").sandbox).toContain("allow-scripts");
  });

  it("builds a same-origin worker path for legacy iframes", () => {
    const legacy = buildLegacyPlan(liverpoolArsenal, "sirtv", NOW);
    expect(playbackUrlForSource(legacy.sources[0], { origin: "https://korazero.com", match: liverpoolArsenal })).toBe(
      "https://korazero.com/wk/albaplayer/sirtv/?ch=bein-sports-1&match=espn-eng.1-401111111&home=Liverpool&away=Arsenal",
    );
  });
});
