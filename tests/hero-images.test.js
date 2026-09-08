import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const repoFile = (relative) => readFileSync(require.resolve(`../${relative}`));

/**
 * Minimal JPEG header reader — enough to prove a hero is the size it claims and
 * that the whole frame is present. Deliberately dependency-free: the point is
 * that this guard runs in plain CI, on every push, with nothing to install.
 */
function readJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("not a JPEG (no SOI)");

  // A frame header (SOFn) carries the real pixel dimensions. C4/C8/CC are not
  // frame headers despite sitting in the same range, so skip those.
  let offset = 2;
  let size = null;
  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break; // start of scan — dimensions are already behind us
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      size = { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      break;
    }
    offset += 2 + length;
  }
  if (!size) throw new Error("no frame header found");

  // A truncated JPEG still parses a header and still renders a partial frame in
  // a browser, so the end-of-image marker is the only honest completeness check.
  const complete = bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  return { ...size, complete, bytes: bytes.length };
}

/* Homepage heroes are owner-supplied artwork. They have shipped downscaled to
   640×360, and once shipped truncated and undecodable at 19 KB, which browsers
   drew as a part-frame. See "Hero images" in AGENTS.md before changing one. */
const HEROES = [
  { file: "assets/img/korazero-saudi.jpg", width: 1672, height: 941 },
  { file: "assets/img/korazero-showdown.jpg", width: 1374, height: 768 },
];

describe("homepage hero artwork", () => {
  for (const hero of HEROES) {
    describe(hero.file, () => {
      const jpeg = readJpeg(repoFile(hero.file));

      it("is not downscaled", () => {
        expect({ width: jpeg.width, height: jpeg.height }).toEqual({
          width: hero.width,
          height: hero.height,
        });
      });

      it("carries a complete frame", () => {
        expect(jpeg.complete).toBe(true);
      });

      it("is not crushed down to a thumbnail", () => {
        // Full-quality heroes run to hundreds of KB. Tens of KB means something
        // re-encoded or truncated the file.
        expect(jpeg.bytes).toBeGreaterThan(100_000);
      });

      it("is the size index.html declares", () => {
        // A stale width/height pair is the clearest sign a hero was silently
        // downscaled and the markup never caught up.
        const html = readFileSync(require.resolve("../index.html"), "utf8");
        const name = hero.file.split("/").pop();
        const tag = html.match(new RegExp(`<img[^>]*${name.replace(".", "\\.")}[^>]*>`, "i"));
        expect(tag, `no <img> for ${name} in index.html`).toBeTruthy();
        expect(Number(tag[0].match(/\bwidth="(\d+)"/)?.[1])).toBe(jpeg.width);
        expect(Number(tag[0].match(/\bheight="(\d+)"/)?.[1])).toBe(jpeg.height);
      });
    });
  }
});
