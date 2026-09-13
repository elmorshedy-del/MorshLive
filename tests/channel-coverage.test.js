import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The canary for the Sep 9-12 outage, restored after the Sep-12 rollback
 * removed it.
 *
 * A channel the site does not model is worse than no channel at all. The card
 * row resolves through CHANNEL_DEFS and falls back to channels[0] for an id it
 * does not know, while mountLabChannel mounts `match.channelId` directly — so
 * the card shows beIN 1 while the player asks the lab for something else. When
 * that something else resolved to a feed carrying no video it drained instead
 * of buffering, and on a max_connections: 1 line the drain took every other
 * viewer with it.
 *
 * Nothing reported it at the time. The data was right, the lab had the channel,
 * and the viewer found out at kickoff. This fails in CI instead.
 */

const repoFile = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

/** The ids assets/js/data.js models, read from the source of truth itself. */
function channelDefIds() {
  const block = /const CHANNEL_DEFS = \[([\s\S]*?)\n\];/.exec(repoFile("assets/js/data.js"));
  expect(block, "CHANNEL_DEFS should be findable in assets/js/data.js").not.toBeNull();
  return [...block[1].matchAll(/id: "([a-z0-9-]+)"/g)].map((m) => m[1]);
}

/** Every channelId any generated or hand-maintained source names, deduped. */
function channelIdsInData() {
  const found = new Map();
  const walk = (node, source) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, source);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "channelId" && typeof value === "string" && value) {
        if (!found.has(value)) found.set(value, source);
      } else {
        walk(value, source);
      }
    }
  };

  for (const file of [
    "assets/data/today.json",
    "assets/data/broadcast-overrides.json",
    "assets/data/manual-channel-overrides.json",
  ]) {
    let raw;
    try {
      raw = repoFile(file);
    } catch {
      continue; // Optional sources; absence is not a failure.
    }
    walk(JSON.parse(raw), file);
  }
  return found;
}

describe("channel coverage", () => {
  it("models every channel the data names", () => {
    const modelled = new Set(channelDefIds());
    for (const [channelId, source] of channelIdsInData()) {
      expect(
        modelled.has(channelId),
        `${source} names "${channelId}", which CHANNEL_DEFS does not model — the card would resolve to channels[0] while the player mounts "${channelId}"`,
      ).toBe(true);
    }
  });

  it("does not model a beIN number the feeds were never confirmed to carry", () => {
    // The exact ids that caused the outage. beIN MENA runs 1-9 and the lab
    // catalogue resolves 5-9 to stream ids with playback URLs — which is what
    // made #245 look verified. Resolving is not playing. Widen this only once
    // the feeds are confirmed to deliver video.
    const modelled = new Set(channelDefIds());
    for (const channelId of ["bein-sports-5", "bein-sports-9"]) {
      expect(modelled.has(channelId), `CHANNEL_DEFS must not model ${channelId}`).toBe(false);
    }
  });
});
