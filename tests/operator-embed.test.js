import { describe, expect, it } from "vitest";
import {
  decodeAlbaPlayerControlSource,
  extractAlbaHlsSources,
  isOperatorAlbaPlayerUrl,
  isScoreBugUrl,
  OPERATOR_EMBED_PATH,
  operatorEmbedProxyPath,
  operatorHlsRefererForHost,
  sanitizeOperatorEmbedHtml,
  unwrapOperatorEmbedUrl,
} from "../lib/operator-embed.js";

const KORALIVE = "https://pl.koralive1.cc/albaplayer/bein1/";
const YALLA = "https://mo.yallacuo.xyz/albaplayer/sport-1/";
const HLS_B64 = "aHR0cHM6Ly9rb3JhMTEuc3J0eTE0NS5kcGRucy5vcmcvbGl2ZS9rb3JhMTEvaW5kZXguY3Nz";
const HLS_URL = "https://kora11.srty145.dpdns.org/live/kora11/index.css";

const POP_HTML = `<!DOCTYPE html><html><head>
<script src="https://llvpn.com/tag.min.js"></script>
<script src="https://widthwidowzoology.com/97/42/b9/ad.js"></script>
<script id="aclib" src="//acscdn.com/script/aclib.js"></script>
<script type="text/javascript">aclib.runPop({ zoneId: '12051082' });</script>
<script>const PlayerPoster='';</script>
<script src="https://pl.koralive1.cc/wp-content/plugins/AlbaPlayer//assets/js/albaplayer.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/hls.js/8.0.0-beta.3/hls.min.js"></script>
</head><body>
<video id="aplr-video" class="hlsjs" controls></video>
<script>AlbaPlayerControl('${HLS_B64}','hls');</script>
<textarea id="aplr-embed-code"><iframe src="https://pl.koralive1.cc/albaplayer/1bein1/?serv=0"></iframe></textarea>
</body></html>`;

describe("operator alba URLs", () => {
  it("accepts yallacuo and koralive albaplayer wrappers", () => {
    expect(isOperatorAlbaPlayerUrl(KORALIVE)).toBe(true);
    expect(isOperatorAlbaPlayerUrl(YALLA)).toBe(true);
    expect(isOperatorAlbaPlayerUrl("https://pl.koralive1.cc/albaplayer/1bein1/?serv=0")).toBe(true);
  });

  it("rejects generic embeds and the koraplus worker path", () => {
    expect(isOperatorAlbaPlayerUrl("https://example.test/embed/bein1")).toBe(false);
    expect(isOperatorAlbaPlayerUrl("/wk/albaplayer/koraplus/?ch=bein-sports-1")).toBe(false);
    expect(isOperatorAlbaPlayerUrl("https://reddit-soccer-streams.online/frame.php")).toBe(false);
  });
});

describe("operator embed proxy path", () => {
  it("rewrites koralive through /wk/operator so the watch page is not a raw popup host", () => {
    const path = operatorEmbedProxyPath(KORALIVE);
    expect(path.startsWith(`${OPERATOR_EMBED_PATH}?u=`)).toBe(true);
    expect(unwrapOperatorEmbedUrl(`https://korazero.com${path}`)).toBe(KORALIVE);
    expect(path).not.toContain("allow-popups");
  });

  it("does not wrap non-alba URLs", () => {
    expect(operatorEmbedProxyPath("https://example.test/embed/bein1")).toBe("");
  });
});

describe("inner AlbaPlayer HLS embed", () => {
  it("decodes the disguised .css stream the wrapper already embeds", () => {
    expect(decodeAlbaPlayerControlSource(HLS_B64)).toBe(HLS_URL);
    expect(extractAlbaHlsSources(POP_HTML)).toEqual([{ source: HLS_URL, player: "hls" }]);
  });

  it("uses a koralive referer for that CDN — korazero.com gets 403", () => {
    expect(operatorHlsRefererForHost("kora11.srty145.dpdns.org")).toEqual({
      referer: "https://pl.koralive1.cc/",
      origin: "https://pl.koralive1.cc",
    });
    expect(operatorHlsRefererForHost("cdn.example.test")).toBeNull();
  });
});

describe("isScoreBugUrl", () => {
  it("accepts a production KoraZero proxy around an allowed operator target", () => {
    expect(
      isScoreBugUrl(
        "https://korazero.com/wk/operator/?u=https%3A%2F%2Fmo.yallacuo.xyz%2Falbaplayer%2Fsport-2%2F",
      ),
    ).toBe(true);
  });

  it("accepts allowed AlbaPlayer wrapper URLs", () => {
    expect(isScoreBugUrl("https://mo.yallacuo.xyz/albaplayer/sport-2/")).toBe(true);
    expect(isScoreBugUrl("https://pl.koralive1.cc/albaplayer/bein1/")).toBe(true);
    expect(isScoreBugUrl("https://pl.koralive.online/albaplayer/bein2/")).toBe(true);
  });

  it("rejects arbitrary URLs, empty strings, and forbidden hosts", () => {
    expect(isScoreBugUrl("")).toBe(false);
    expect(isScoreBugUrl("https://example.com/embed/foo")).toBe(false);
    expect(isScoreBugUrl("https://reddit-soccer-streams.online/")).toBe(false);
    expect(isScoreBugUrl("https://korazero.com/watch?ch=bein-sports-1")).toBe(false);
    expect(isScoreBugUrl("https://korazero.com/wk/albaplayer/koraplus/?ch=bein-sports-1")).toBe(false);
    expect(isScoreBugUrl("https://staging.korazero.com/wk/operator/")).toBe(false);
    expect(isScoreBugUrl("https://korazero.com/wk/operator/?u=https%3A%2F%2Fexample.com%2Fembed%2Ffoo")).toBe(
      false,
    );
  });
});

describe("sanitizeOperatorEmbedHtml", () => {
  it("strips popunder scripts and keeps the inner HLS control", () => {
    const out = sanitizeOperatorEmbedHtml(POP_HTML, KORALIVE);
    expect(out).not.toMatch(/aclib/i);
    expect(out).not.toMatch(/runPop/);
    expect(out).not.toMatch(/llvpn/i);
    expect(out).not.toMatch(/widthwidow/i);
    expect(out).toContain("albaplayer.js");
    expect(out).toContain("AlbaPlayerControl");
    expect(out).toContain(HLS_B64);
    expect(out).not.toMatch(/sandbox=/);
    expect(out).toMatch(/<base href="https:\/\/pl\.koralive1\.cc\/albaplayer\/bein1\/">/);
  });
});
