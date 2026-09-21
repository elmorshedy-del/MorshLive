import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const repoFile = (relative) => readFileSync(require.resolve(`../${relative}`));

function readJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("not a JPEG (no SOI)");
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
    if (marker === 0xda) break;
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      size = { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      break;
    }
    offset += 2 + length;
  }
  if (!size) throw new Error("no frame header found");
  const complete = bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  return { ...size, complete, bytes: bytes.length };
}

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
        expect(jpeg.bytes).toBeGreaterThan(100_000);
      });

      it("is the size index.html declares", () => {
        const html = readFileSync(require.resolve("../index.html"), "utf8");
        const name = hero.file.split("/").pop();
        const tag = html.match(new RegExp(`<img[^>]*${name.replace(".", "\\.")}[^>]*>`, "i"));
        expect(tag, `no <img> for ${name} in index.html`).toBeTruthy();
        expect(Number(tag[0].match(/\bwidth="(\d+)"/)?.[1])).toBe(jpeg.width);
        expect(Number(tag[0].match(/\bheight="(\d+)"/)?.[1])).toBe(jpeg.height);
      });
    });
  }

  it("wires the Khaleeji 27 slide at native 1500x844", () => {
    const injector = readFileSync(require.resolve("../assets/js/khaleeji-hero.js"), "utf8");
    const css = readFileSync(require.resolve("../assets/css/home-showdown.css"), "utf8");
    expect(injector).toMatch(/width = 1500/);
    expect(injector).toMatch(/height = 844/);
    expect(injector).toMatch(/korazero-khaleeji27/);
    expect(css).toMatch(/width: 300%/);
  });
});
