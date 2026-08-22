import { describe, expect, it } from "vitest";
import { chooseGo4scoreEdge, go4scoreFrameUrl, pickGo4scoreChannel } from "../lib/go4score-frame.js";

const channels = [
  { ch: "alwan1", key: "alwan1" },
  { ch: "b1", key: "b1", server_name: "Bein Sport 1" },
];

describe("pickGo4scoreChannel", () => {
  it("prefers BeIN Sports 1 when the match lists it", () => {
    expect(pickGo4scoreChannel(channels)?.ch).toBe("b1");
  });

  it("falls back to the first channel", () => {
    expect(pickGo4scoreChannel([{ ch: "max1" }])?.ch).toBe("max1");
  });
});

describe("go4scoreFrameUrl", () => {
  it("builds an unsandboxed frame.php URL on the match edge domain", () => {
    expect(
      go4scoreFrameUrl({
        edges: ["a11", "a12"],
        edgeDomain: "kora-plus.li",
        edge: "a13",
        channel: "b1",
        token: "tok",
        kt: "1770000000",
      }),
    ).toBe("https://a13.kora-plus.li/frame.php?ch=b1&p=12&token=tok&kt=1770000000");
  });

  it("uses the fallback host when edges are missing", () => {
    expect(go4scoreFrameUrl({ channel: "b1", fallbackHost: "a11.kora-plus.app" })).toBe(
      "https://a11.kora-plus.app/frame.php?ch=b1&p=12",
    );
  });
});

describe("chooseGo4scoreEdge", () => {
  it("picks from the provided edge list", () => {
    expect(chooseGo4scoreEdge(["a11", "a12"], () => 0.9)).toBe("a12");
  });
});
