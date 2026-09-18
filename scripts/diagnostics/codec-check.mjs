#!/usr/bin/env node
/**
 * KoraZero Diagnostics — prove the browser can actually decode, before any
 * media experiment is allowed to draw a conclusion from it.
 *
 * On 2026-09-17 a browser comparison of two feeds reported NEVER STARTED for
 * both and was read as evidence about the feeds. It was not: Playwright's
 * bundled Chromium is the open-source build, which ships without the
 * proprietary H.264/AAC decoders. Every codec-dependent browser result from
 * that build is void.
 *
 * Branded Google Chrome and Microsoft Edge do carry those decoders, so
 * `channel: "chrome"` is the only valid vehicle here. This script proves it
 * rather than assuming it, in three escalating steps, because each one can pass
 * while the next fails:
 *
 *   1. canPlayType   — the element will *accept* the type. Says nothing about
 *                      whether a decoder exists.
 *   2. MediaSource.isTypeSupported — MSE will accept the codec string. Closer,
 *                      still a claim rather than a demonstration.
 *   3. actual decode  — a real sample is played and currentTime advances with
 *                      decoded frames. This is the only one that is evidence.
 *
 * It opens no provider stream and costs nothing on the line.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

// Playwright bundles a stripped ffmpeg (vp8/webm only), so use the system one.
const FFMPEG = fs.existsSync("/usr/bin/ffmpeg") ? "/usr/bin/ffmpeg" : "/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux";

/** A tiny, known-good H.264 + AAC MP4. Generated, so nothing is fetched. */
function makeSample(dir) {
  const out = path.join(dir, "sample.mp4");
  execFileSync(
    FFMPEG,
    [
      "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.0", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "64k",
      "-movflags", "+faststart",
      out,
    ],
    { stdio: "pipe" },
  );
  return out;
}

const CODECS = {
  "H.264 baseline + AAC": 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
  "H.264 high + AAC": 'video/mp4; codecs="avc1.64001f, mp4a.40.2"',
  "HEVC / H.265 main": 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  "HEVC / H.265 (hev1)": 'video/mp4; codecs="hev1.1.6.L93.B0"',
  "MPEG-TS H.264 + AAC": 'video/mp2t; codecs="avc1.42E01E, mp4a.40.2"',
};

async function main() {
  const channel = process.argv.includes("--edge") ? "msedge" : "chrome";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kz-codec-"));
  let sample = null;
  try {
    sample = makeSample(dir);
  } catch (error) {
    console.error(`could not build the decode sample with ffmpeg: ${error.message}`);
  }

  let browser;
  try {
    browser = await chromium.launch({ channel, args: ["--no-sandbox"] });
  } catch (error) {
    console.log(`BRANDED BROWSER NOT AVAILABLE (${channel}): ${error.message.split("\n")[0]}`);
    console.log("Install with: npx playwright install chrome");
    process.exit(3);
  }

  const page = await browser.newPage();
  await page.goto("about:blank");

  const claims = await page.evaluate((codecs) => {
    const v = document.createElement("video");
    const out = { userAgent: navigator.userAgent, codecs: {} };
    for (const [label, type] of Object.entries(codecs)) {
      out.codecs[label] = {
        canPlayType: v.canPlayType(type) || "(empty = no)",
        mseSupported: Boolean(globalThis.MediaSource?.isTypeSupported?.(type)),
      };
    }
    return out;
  }, CODECS);

  console.log(`\nbrowser channel : ${channel}`);
  console.log(`user agent      : ${claims.userAgent}`);
  console.log(`\n${"capability claims".padEnd(24)} ${"canPlayType".padEnd(14)} MediaSource.isTypeSupported`);
  console.log("-".repeat(72));
  for (const [label, r] of Object.entries(claims.codecs)) {
    console.log(`${label.padEnd(24)} ${r.canPlayType.padEnd(14)} ${r.mseSupported}`);
  }

  // Step 3 — the only step that is evidence.
  let decode = { ran: false };
  if (sample) {
    const dataUrl = `data:video/mp4;base64,${fs.readFileSync(sample).toString("base64")}`;
    decode = await page.evaluate(async (src) => {
      const v = document.createElement("video");
      v.muted = true;
      v.src = src;
      document.body.appendChild(v);
      const settled = new Promise((resolve) => {
        v.addEventListener("error", () => resolve("error"), { once: true });
        v.addEventListener("playing", () => resolve("playing"), { once: true });
        setTimeout(() => resolve("timeout"), 8000);
      });
      try {
        await v.play();
      } catch (e) {
        return { ran: true, outcome: `play() rejected: ${String(e).slice(0, 80)}` };
      }
      const outcome = await settled;
      await new Promise((r) => setTimeout(r, 1200));
      const q = v.getVideoPlaybackQuality?.();
      return {
        ran: true,
        outcome,
        currentTime: +v.currentTime.toFixed(2),
        readyState: v.readyState,
        videoWidth: v.videoWidth,
        decodedFrames: q?.totalVideoFrames ?? null,
        droppedFrames: q?.droppedVideoFrames ?? null,
        mediaError: v.error ? v.error.code : null,
      };
    }, dataUrl);
  }

  console.log(`\n${"decode proof (real H.264/AAC sample)".padEnd(40)}`);
  console.log("-".repeat(72));
  if (!decode.ran) {
    console.log("  NOT RUN — no sample could be generated");
  } else {
    for (const [k, v] of Object.entries(decode)) if (k !== "ran") console.log(`  ${k.padEnd(16)}: ${v}`);
  }

  const h264Decodes =
    decode.ran &&
    decode.outcome === "playing" &&
    decode.currentTime > 0 &&
    decode.videoWidth > 0 &&
    (decode.decodedFrames === null || decode.decodedFrames > 0) &&
    decode.mediaError === null;

  const hevcClaimed = Object.entries(claims.codecs).some(
    ([label, r]) => label.includes("HEVC") && (r.mseSupported || r.canPlayType.includes("probably")),
  );

  console.log(`\n${"=".repeat(72)}`);
  console.log(h264Decodes ? "H264 BROWSER TEST AVAILABLE — decode proven, not merely claimed" : "H264 DECODE NOT PROVEN — do not draw codec conclusions from this browser");
  console.log(
    hevcClaimed
      ? "HEVC claimed by this browser — still verify with a real HEVC sample before using it as evidence"
      : "HEVC BROWSER TEST NOT AVAILABLE IN THIS ENVIRONMENT — infer nothing about the 7053 path, and nothing about iPhone/Safari",
  );
  console.log("=".repeat(72));

  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(h264Decodes ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
