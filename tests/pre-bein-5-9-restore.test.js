import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveBroadcastChannel } = require("../scripts/broadcast-registry.js");

function loadSiteChannels() {
  const window = {};
  const context = {
    window,
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      getElementById: () => null,
    },
    location: { origin: "https://korazero.com", search: "" },
    navigator: { language: "ar" },
    URL,
    URLSearchParams,
    fetch: async () => ({ ok: false }),
    console,
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  createContext(context);
  runInContext(readFileSync(require.resolve("../assets/js/data.js"), "utf8"), context);
  return window.SITE_DATA.CHANNELS;
}

describe("pre-beIN-5-9 production boundary", () => {
  it("models beIN Sports 1-4 on normal match cards and nothing above 4", () => {
    const ids = loadSiteChannels()
      .filter((channel) => channel.group === "beIN")
      .map((channel) => channel.id);

    expect(ids).toEqual(["bein-sports-1", "bein-sports-2", "bein-sports-3", "bein-sports-4"]);
  });

  it("keeps automatic broadcaster routing inside Sports 1-4", () => {
    for (let number = 1; number <= 4; number += 1) {
      expect(resolveBroadcastChannel(`beIN Sports ${number}`)).toMatchObject({
        channel: `beIN Sports ${number}`,
        broadcastChannelId: `bein-sports-${number}`,
        playbackChannelId: `bein-sports-${number}`,
        confidence: "exact",
      });
    }

    for (const number of [5, 6, 7, 8, 9]) {
      expect(resolveBroadcastChannel(`beIN Sports ${number}`)).toMatchObject({
        channel: "beIN Sports 1",
        broadcastChannelId: "bein-sports-1",
        playbackChannelId: "bein-sports-1",
        confidence: "network",
      });
    }
  });
});
