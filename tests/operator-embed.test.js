import { describe, expect, it } from "vitest";
import {
  isOperatorAlbaPlayerUrl,
  OPERATOR_EMBED_PATH,
  OPERATOR_IFRAME_SANDBOX,
  operatorEmbedProxyPath,
  sanitizeOperatorEmbedHtml,
  unwrapOperatorEmbedUrl,
} from "../lib/operator-embed.js";

const KORALIVE = "https://pl.koralive1.cc/albaplayer/bein1/";
const YALLA = "https://mo.yallacuo.xyz/albaplayer/sport-1/";

const POP_HTML = `<!DOCTYPE html><html><head>
<script src="https://llvpn.com/tag.min.js"></script>
<script src="https://widthwidowzoology.com/97/42/b9/ad.js"></script>
<script id="aclib" src="//acscdn.com/script/aclib.js"></script>
<script type="text/javascript">aclib.runPop({ zoneId: '12051082' });</script>
<script>const PlayerPoster='';</script>
<script src="https://pl.koralive1.cc/wp-content/plugins/AlbaPlayer//assets/js/albaplayer.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/hls.js/8.0.0-beta.3/hls.min.js"></script>
</head><body>
<iframe id="streamFrame" src="https://pl.koralive1.cc/albaplayer/1bein1/?serv=0"></iframe>
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

describe("sanitizeOperatorEmbedHtml", () => {
  it("strips popunder scripts and sandboxes nested iframes without allow-popups", () => {
    const out = sanitizeOperatorEmbedHtml(POP_HTML, KORALIVE);
    expect(out).not.toMatch(/aclib/i);
    expect(out).not.toMatch(/runPop/);
    expect(out).not.toMatch(/llvpn/i);
    expect(out).not.toMatch(/widthwidow/i);
    expect(out).toContain("albaplayer.js");
    expect(out).toContain("hls.min.js");
    expect(out).toContain("PlayerPoster");
    expect(out).toContain(`sandbox="${OPERATOR_IFRAME_SANDBOX}"`);
    expect(out).not.toMatch(/allow-popups/);
    expect(out).toMatch(/<base href="https:\/\/pl\.koralive1\.cc\/albaplayer\/bein1\/">/);
  });
});
