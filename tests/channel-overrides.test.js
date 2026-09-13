import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { applyChannelOverrides, loadChannelOverrides } = require("../scripts/channel-overrides-lib.js");

function files(manual, generated) {
  const dir = mkdtempSync(join(tmpdir(), "kz-overrides-"));
  const manualFile = join(dir, "manual.json");
  const generatedFile = join(dir, "generated.json");
  writeFileSync(manualFile, JSON.stringify(manual ?? {}));
  writeFileSync(generatedFile, JSON.stringify(generated ?? {}));
  return { manualFile, generatedFile };
}

/**
 * The scheduled refresh rewrites commentaryIndex from almaghrebsport every run,
 * so a channel number corrected inside today.json is gone by the next run. This
 * layer is what makes a correction survive: it is applied after the feed, from
 * files the feed never writes.
 */
describe("loading overrides", () => {
  it("reads the generated file", () => {
    const map = loadChannelOverrides(
      files(null, {
        source: "goal.com",
        rows: { "espn-uefa.champions-1": { channel: "beIN Sports 4", channelId: "bein-sports-4" } },
      }),
    );
    expect(map.get("espn-uefa.champions-1")).toMatchObject({
      channelId: "bein-sports-4",
      source: "goal.com",
    });
  });

  it("lets a hand-made override outrank the generated one", () => {
    // The generated file is rewritten whole on every harvest, so a correction
    // that must stick belongs in the manual file — which nothing generates.
    const map = loadChannelOverrides(
      files(
        { "espn-uefa.champions-1": { channel: "beIN Sports 2", channelId: "bein-sports-2" } },
        {
          source: "goal.com",
          rows: { "espn-uefa.champions-1": { channel: "beIN Sports 4", channelId: "bein-sports-4" } },
        },
      ),
    );
    expect(map.get("espn-uefa.champions-1")).toMatchObject({ channelId: "bein-sports-2", source: "manual" });
  });

  it("ignores rows that name no channel", () => {
    const map = loadChannelOverrides(
      files({ a: { reason: "pending" } }, { rows: { b: { channel: "beIN Sports 1" } } }),
    );
    expect(map.size).toBe(0);
  });

  it("survives a missing or unreadable file", () => {
    expect(loadChannelOverrides({ manualFile: "/nope/a.json", generatedFile: "/nope/b.json" }).size).toBe(0);
  });
});

describe("applying overrides", () => {
  const fixture = () => ({
    id: "espn-uefa.champions-9",
    home: "Borussia Dortmund",
    away: "Athletic Club",
    channel: "beIN Sports 1",
    channelId: "bein-sports-1",
    commentators: [{ name: "حفيظ دراجي" }],
  });

  const overrides = () =>
    new Map([
      ["espn-uefa.champions-9", { channel: "beIN Sports 4", channelId: "bein-sports-4", source: "goal.com" }],
    ]);

  it("corrects the fixture and the commentary row together", () => {
    // Correcting only the fixture would leave today.json — and so the watch
    // page — on the feed's number.
    const match = fixture();
    const index = [
      {
        key: "borussia-dortmund|athletic-club",
        home: match.home,
        away: match.away,
        channel: "beIN Sports 1",
        channelId: "bein-sports-1",
        commentators: match.commentators,
      },
    ];
    const { pairKey } = require("../scripts/commentators-lib.js");
    index[0].key = pairKey(match.home, match.away);

    expect(applyChannelOverrides([match], index, overrides())).toBe(1);
    expect(match.channelId).toBe("bein-sports-4");
    expect(index[0].channelId).toBe("bein-sports-4");
    expect(index[0].channelBinding).toBe("resolved");
  });

  it("keeps the commentators the feed supplied", () => {
    // almaghrebsport is still the right source for commentators. Only its
    // channel guess is being replaced.
    const match = fixture();
    const { pairKey } = require("../scripts/commentators-lib.js");
    const index = [
      {
        key: pairKey(match.home, match.away),
        commentators: match.commentators,
        channel: "beIN Sports 1",
        channelId: "bein-sports-1",
      },
    ];
    applyChannelOverrides([match], index, overrides());
    expect(index[0].commentators).toEqual([{ name: "حفيظ دراجي" }]);
    expect(match.commentators).toEqual([{ name: "حفيظ دراجي" }]);
  });

  it("adds a row for a fixture the feed never mentioned", () => {
    const match = fixture();
    delete match.channelId;
    const index = [];
    expect(applyChannelOverrides([match], index, overrides())).toBe(1);
    expect(index).toHaveLength(1);
    expect(index[0].channelId).toBe("bein-sports-4");
  });

  it("records an override that agrees, without counting it as a change", () => {
    // ESPN seeds every fixture with beIN 1, so "already on this channel" is the
    // unknown case, not a confirmed one. Agreement still has to be stamped or
    // the channel stays marked contested and the next feed run is free to move
    // it; the count stays 0 because nothing about the number changed.
    const match = fixture();
    match.channelId = "bein-sports-4";
    expect(applyChannelOverrides([match], [], overrides())).toBe(0);
    expect(match.channelId).toBe("bein-sports-4");
    expect(match.channelBinding).toBe("resolved");
    expect(match.channelSource).toBe("goal.com");
  });

  it("touches nothing when there are no overrides", () => {
    const match = fixture();
    expect(applyChannelOverrides([match], [], new Map())).toBe(0);
    expect(applyChannelOverrides([match], [], null)).toBe(0);
    expect(match.channelId).toBe("bein-sports-1");
  });
});

/**
 * A channel CHANNEL_DEFS does not model is worse than no channel at all:
 * resolveWatchSelection falls back to channels[0] for the row while
 * mountLabChannel reads match.channelId directly, so the card shows one channel
 * and the player asks the lab for another. beIN 5-9 reached viewers that way and
 * drained instead of buffering.
 *
 * Taking the channels back out of CHANNEL_DEFS did not stop it, because
 * mergeCommentaryIndex carries a previously written row forward for as long as
 * its fixture is around. This runs after the merge for that reason.
 */
describe("channels the site cannot route are stripped", () => {
  const { stripUnroutableChannels } = require("../scripts/channel-overrides-lib.js");

  it("clears an unroutable channel and keeps the commentators", () => {
    const row = {
      key: "a|b",
      channel: "beIN Sports 9",
      channelId: "bein-sports-9",
      channelBinding: "resolved",
      channelSource: "goal.com",
      commentators: [{ name: "حفيظ دراجي" }],
    };
    expect(stripUnroutableChannels([], [row])).toBe(1);
    expect(row.channelId).toBeUndefined();
    expect(row.channel).toBeUndefined();
    expect(row.channelBinding).toBeUndefined();
    expect(row.commentators).toEqual([{ name: "حفيظ دراجي" }]);
  });

  it("leaves every channel the site does model alone", () => {
    const rows = ["bein-sports-1", "bein-sports-4", "bein-max-2", "ssc-3", "thmanyah-2"].map((id) => ({
      channelId: id,
      channel: id,
    }));
    expect(stripUnroutableChannels([], rows)).toBe(0);
    expect(rows.map((r) => r.channelId)).toEqual([
      "bein-sports-1",
      "bein-sports-4",
      "bein-max-2",
      "ssc-3",
      "thmanyah-2",
    ]);
  });

  it("cleans the fixture as well as its row", () => {
    // mountLabChannel reads match.channelId, so leaving the fixture dirty would
    // leave the player still asking for the channel that drains.
    const match = { id: "espn-esp.1-1", channelId: "bein-sports-9", channel: "beIN Sports 9" };
    expect(stripUnroutableChannels([match], [])).toBe(1);
    expect(match.channelId).toBeUndefined();
  });

  it("drops a broadcast block pointing at the same unroutable channel", () => {
    const row = {
      channelId: "bein-sports-5",
      broadcast: { provider: "bein", channelId: "bein-sports-5" },
    };
    stripUnroutableChannels([], [row]);
    expect(row.broadcast).toBeUndefined();
  });
});
