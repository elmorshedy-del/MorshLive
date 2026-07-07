#!/usr/bin/env node
/**
 * Playwright: verify alt-stream iframes — NTV must NOT have sandbox; Sir TV should.
 * Saves screenshots to /opt/cursor/artifacts/screenshots/ for visual proof.
 *
 * Usage:
 *   node scripts/verify-alt-streams.mjs [watchUrl] [outDir]
 */
import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";

const WATCH_URL =
  process.argv[2] ||
  "https://korazero.com/watch.html?ch=bein-max-1&match=espn-fifa.world-760506";
const OUT_DIR = process.argv[3] || "/opt/cursor/artifacts/screenshots";

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });

  console.log("Opening", WATCH_URL);
  await page.goto(WATCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  await page.waitForSelector("#alt-streams:not([hidden])", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);

  const iframes = await page.evaluate(() => {
    const frames = [...document.querySelectorAll(".alt-stream-frame")];
    return frames.map((f) => {
      const pane = f.closest(".alt-stream-pane");
      return {
        kind: pane?.classList.contains("alt-stream-pane--ntv")
          ? "ntv"
          : pane?.classList.contains("alt-stream-pane--sirtv")
            ? "sirTv"
            : "unknown",
        src: f.src,
        sandbox: f.getAttribute("sandbox"),
        hasSandbox: f.hasAttribute("sandbox"),
      };
    });
  });

  console.log("alt-stream iframes:", JSON.stringify(iframes, null, 2));

  const shot = path.join(OUT_DIR, `alt-streams-${ts()}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  console.log("screenshot:", shot);

  const ntv = iframes.find((f) => f.kind === "ntv");
  const sir = iframes.find((f) => f.kind === "sirTv");

  const ntvFrame = page.frames().find((f) => /streams\.center/i.test(f.url()));
  let ntvInner = ntv?.src || null;
  if (ntvFrame) {
    ntvInner = ntvFrame.url();
    console.log("NTV frame url:", ntvInner);
  }

  await browser.close();

  if (!ntv) throw new Error("NTV alt-stream iframe not found — is match pinned?");
  if (ntv.hasSandbox) {
    throw new Error(`NTV iframe still has sandbox="${ntv.sandbox}" — fix altStreamIframe kind param`);
  }
  if (!ntvInner || !/streams\.center/i.test(ntvInner)) {
    throw new Error(`NTV must load streams.center directly (got ${ntvInner || "none"})`);
  }
  if (sir && !sir.hasSandbox) {
    console.warn("warn: Sir TV iframe has no sandbox (acceptable but unexpected)");
  }

  console.log("\n✓ NTV iframe has no sandbox attribute");
  console.log("✓ NTV inner embed:", ntvInner);
  if (sir) console.log("✓ Sir TV iframe sandbox:", sir.sandbox || "(none)");
})();
