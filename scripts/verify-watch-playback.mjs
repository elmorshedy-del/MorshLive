#!/usr/bin/env node
/**
 * Playwright: watch page shows one player (no fake servers/tabs) and content plays.
 */
import { chromium } from "playwright-core";

const WATCH_URL =
  process.argv[2] ||
  "https://korazero.com/watch?ch=bein-sports-1&match=espn-fifa.world-760496";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  const navs = [];

  page.on("framenavigated", (frame) => {
    if (frame.parentFrame()) navs.push(frame.url());
  });

  console.log("Opening", WATCH_URL);
  await page.goto(WATCH_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#player-shell iframe", { timeout: 20000 });

  const shell = await page.evaluate(() => ({
    iframe: document.querySelector("#player-shell iframe")?.src,
    servers: document.querySelectorAll("#servers .server-btn").length,
    playerSwitch: document.querySelectorAll(".player-switch-btn").length,
  }));
  console.log("shell:", shell);

  if (shell.servers || shell.playerSwitch) {
    throw new Error("Decorative servers/players still visible");
  }
  if (!shell.iframe?.includes("/wk/albaplayer/")) {
    throw new Error(`Unexpected iframe: ${shell.iframe}`);
  }

  const startSrc = shell.iframe;
  let frame = null;
  for (let i = 0; i < 20; i++) {
    frame = page.frames().find((f) => f.url().includes("/wk/albaplayer/"));
    if (frame) break;
    await page.waitForTimeout(1000);
  }
  if (!frame) throw new Error("VIP iframe not found");

  let playable = false;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    const state = await frame.evaluate(() => {
      const video = document.querySelector("video");
      if (video) {
        return {
          kind: "video",
          readyState: video.readyState,
          currentTime: video.currentTime,
          paused: video.paused,
        };
      }
      const qualityBar = document.querySelector("#kz-quality");
      if (qualityBar) {
        return {
          kind: "twitch-api",
          qualityButtons: qualityBar.querySelectorAll("button").length,
          hasPlayer: !!document.querySelector("#kz-twitch"),
        };
      }
      const twitch = document.querySelector('iframe[src*="twitch"]');
      if (twitch) {
        return { kind: "twitch", src: twitch.src };
      }
      return null;
    });
    console.log(`probe ${i + 1}:`, state);
    if (state?.kind === "video" && state.readyState >= 2 && (state.currentTime > 0 || !state.paused)) {
      playable = true;
      break;
    }
    if (state?.kind === "twitch-api" && state.hasPlayer) {
      playable = true;
      if (state.qualityButtons < 2) {
        console.warn("Twitch quality bar has fewer than 2 options (stream may be source-only)");
      } else {
        console.log("Twitch quality choices:", state.qualityButtons);
      }
      break;
    }
    if (state?.kind === "twitch" && /parent=korazero\.com/i.test(state.src || "")) {
      playable = true;
      break;
    }
  }

  const endSrc = await page.evaluate(() => document.querySelector("#player-shell iframe")?.src);
  const reloadLoop = startSrc !== endSrc;
  console.log("reload loop?", reloadLoop, "navigations:", navs.length);

  await browser.close();

  if (reloadLoop) throw new Error("Iframe reload loop detected");
  if (!playable) throw new Error("No playable video or Twitch embed detected");
  console.log("\n✓ Single-player watch page has live content");
})();
