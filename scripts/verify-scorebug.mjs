#!/usr/bin/env node
/**
 * Quick single-URL visual check for match-day scorebug confirmation.
 *
 * Opens one allowed URL (KoraZero /wk/operator/ or yallacuo/koralive AlbaPlayer),
 * waits briefly, captures a screenshot, and prints concise diagnostics.
 *
 * Does NOT auto-bind, record verification, or claim visual proof.
 * Use apply-stream-plan-verify.mjs to record a result after human review.
 *
 * Usage:
 *   node scripts/verify-scorebug.mjs --url=<url> --match=<espn-id> [--out=dir] [--wait=ms]
 *
 * Options:
 *   --url=<url>       Required. KoraZero /wk/operator/ or AlbaPlayer wrapper URL.
 *   --match=<espn-id> Required. ESPN match id for the screenshot filename.
 *   --out=<dir>       Screenshot output directory (default: reports/scorebug).
 *   --wait=<ms>       Maximum wait for a playing video (default: 5000).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./lib/browser.mjs";
import { isScoreBugUrl } from "../lib/operator-embed.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const cfg = {
    url: "",
    match: "",
    outDir: path.join(ROOT, "reports", "scorebug"),
    waitMs: 5000,
  };
  for (const arg of argv) {
    if (arg.startsWith("--url=")) cfg.url = arg.slice(6);
    else if (arg.startsWith("--match=")) cfg.match = arg.slice(8);
    else if (arg.startsWith("--out=")) cfg.outDir = arg.slice(6);
    else if (arg.startsWith("--wait=")) cfg.waitMs = Math.max(0, Number(arg.slice(7)) || 5000);
  }
  return cfg;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));

  if (!cfg.url) {
    console.error("error: --url is required");
    process.exit(1);
  }
  if (!cfg.match) {
    console.error("error: --match is required");
    process.exit(1);
  }
  if (!isScoreBugUrl(cfg.url)) {
    console.error(
      "error: URL not allowed for scorebug verification.\n" +
        "  Allowed: KoraZero /wk/operator/ URLs or yallacuo/koralive AlbaPlayer URLs.\n" +
        `  Got: ${cfg.url}`,
    );
    process.exit(2);
  }

  fs.mkdirSync(cfg.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeMatch = cfg.match.replace(/[^a-z0-9._-]/gi, "_");
  const screenshotPath = path.join(cfg.outDir, `scorebug-${safeMatch}-${stamp}.png`);

  const t0 = Date.now();
  const browser = await launchBrowser({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });

  let finalUrl = cfg.url;
  let httpStatus = null;
  let hasVideo = false;
  let videoReadyState = -1;
  let videoCurrentTime = 0;
  let videoPaused = true;
  let iframeCount = 0;
  let iframeSrcs = [];
  let errorMsg = "";

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    let page;
    context.on("page", (candidate) => {
      if (page && candidate !== page) candidate.close().catch(() => {});
    });
    page = await context.newPage();

    const navigation = await page.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    httpStatus = navigation?.status() ?? null;
    finalUrl = page.url();

    if (cfg.waitMs > 0) {
      await page
        .waitForFunction(
          () => {
            const video = document.querySelector("video");
            return Boolean(video && video.readyState >= 2 && video.currentTime > 0);
          },
          null,
          { timeout: cfg.waitMs },
        )
        .catch(() => {});
      await page.waitForTimeout(500);
    }

    const probe = await page.evaluate(() => {
      const video = document.querySelector("video");
      const frames = Array.from(document.querySelectorAll("iframe"));
      return {
        hasVideo: !!video,
        videoReadyState: video ? video.readyState : -1,
        videoCurrentTime: video ? video.currentTime : 0,
        videoPaused: video ? video.paused : true,
        iframeCount: frames.length,
        iframeSrcs: frames.map((f) => f.src || f.getAttribute("src") || "").slice(0, 5),
      };
    });

    hasVideo = probe.hasVideo;
    videoReadyState = probe.videoReadyState;
    videoCurrentTime = probe.videoCurrentTime;
    videoPaused = probe.videoPaused;
    iframeCount = probe.iframeCount;
    iframeSrcs = probe.iframeSrcs;

    await page.screenshot({ path: screenshotPath, fullPage: false });
    await context.close();
  } catch (err) {
    errorMsg = String(err?.message ?? err);
  } finally {
    await browser.close();
  }

  const elapsed = Date.now() - t0;

  const diag = {
    match: cfg.match,
    url: cfg.url,
    finalUrl: finalUrl !== cfg.url ? finalUrl : undefined,
    httpStatus,
    hasVideo,
    videoReadyState,
    videoCurrentTime: Number(videoCurrentTime.toFixed(2)),
    videoPaused,
    iframeCount,
    ...(iframeSrcs.length ? { iframeSrcs } : {}),
    screenshot: screenshotPath,
    elapsedMs: elapsed,
    ...(errorMsg ? { error: errorMsg } : {}),
  };

  // Remove undefined fields
  for (const k of Object.keys(diag)) {
    if (diag[k] === undefined) delete diag[k];
  }

  console.log(JSON.stringify(diag, null, 2));
  console.log(`\nscreenshot : ${screenshotPath}`);
  console.log(`elapsed    : ${elapsed}ms`);
  console.log(`status     : ${httpStatus ?? "n/a"}`);
  console.log(`video      : ${hasVideo} | iframes: ${iframeCount}`);
  if (errorMsg) console.log(`error      : ${errorMsg}`);
  console.log("\nNOTE: visual check only — run apply-stream-plan-verify.mjs to record the result.");
  if (errorMsg) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
