#!/usr/bin/env node
import { chromium, devices, webkit } from "playwright";

const TARGET = process.argv[2] ||
  "https://korazero.com/watch.html?ch=bein-sports-2&match=espn-esp.1-401882867&source=xtream&portal=lab&stream=2454&premium=1&premiumChannelId=bein-sports-2";

async function verify(name, browserType, contextOptions = {}) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(25000);

  const consoleErrors = [];
  const failedRequests = [];
  const requests = [];
  let probe = null;
  let selected = null;

  await page.addInitScript(() => {
    window.__pwHeartbeat = 0;
    setInterval(() => { window.__pwHeartbeat += 1; }, 100);
  });

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("request", (request) => requests.push(request.url()));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.url()} :: ${request.failure()?.errorText || "failed"}`);
  });
  page.on("response", async (response) => {
    const url = response.url();
    try {
      if (url.includes("/api/xtream/probe?")) probe = await response.json();
      if (url.includes("/api/xtream/live?")) {
        const body = await response.json();
        selected = (body.portals || []).flatMap((block) => block.streams || [])[0] || null;
      }
    } catch {}
  });

  try {
    const response = await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!response?.ok()) throw new Error(`navigation HTTP ${response?.status()}`);

    await page.waitForFunction(() => window.__KZ_WATCH_LOADER === "xtream");
    await page.waitForFunction(() => window.__KZ_WATCH_IMPL === "xtream");
    await page.waitForSelector("#player-shell video, #player-shell [data-xtream-state=\"error\"], #player-shell [data-xtream-state=\"timeout\"]");

    await page.waitForTimeout(3500);
    const heartbeat = await page.evaluate(() => window.__pwHeartbeat || 0);
    if (heartbeat < 20) throw new Error(`main thread heartbeat stalled (${heartbeat})`);

    await page.waitForFunction(() => {
      const video = document.querySelector("#player-shell video");
      const terminal = document.querySelector("#player-shell [data-xtream-state=\"error\"], #player-shell [data-xtream-state=\"timeout\"]");
      return terminal || (video && (video.dataset.playbackStarted === "1" || video.readyState >= 2));
    }, { timeout: 25000 }).catch(() => {});

    const snapshot = await page.evaluate(() => {
      const video = document.querySelector("#player-shell video");
      const terminal = document.querySelector("#player-shell [data-xtream-state=\"error\"], #player-shell [data-xtream-state=\"timeout\"]");
      return {
        impl: window.__KZ_WATCH_IMPL,
        loader: window.__KZ_WATCH_LOADER,
        heartbeat: window.__pwHeartbeat,
        terminal: terminal?.getAttribute("data-xtream-state") || null,
        terminalText: terminal?.textContent?.trim() || null,
        video: video ? {
          protocol: video.dataset.xtreamProtocol || null,
          readyState: video.readyState,
          networkState: video.networkState,
          currentTime: video.currentTime,
          paused: video.paused,
          started: video.dataset.playbackStarted === "1",
          loaded: video.dataset.mediaLoaded === "1",
          error: video.error ? { code: video.error.code, message: video.error.message } : null,
        } : null,
      };
    });

    if (requests.some((url) => url.includes("/api/iptv-lab/catalog"))) {
      throw new Error("watch page fetched the full IPTV catalog");
    }
    if (!probe?.playable || probe.protocol !== "ts") {
      throw new Error(`unexpected probe: ${JSON.stringify(probe)}`);
    }
    if (!selected?.tsPlaybackUrl) throw new Error("live API did not return tsPlaybackUrl");
    if (snapshot.video?.protocol !== "ts") {
      throw new Error(`TS-first player was not mounted: ${JSON.stringify(snapshot)}`);
    }

    const origin = new URL(TARGET).origin;
    const tsAbsolute = new URL(selected.tsPlaybackUrl, origin).toString();
    const hlsAbsolute = selected.playbackUrl ? new URL(selected.playbackUrl, origin).toString() : "";
    if (!requests.includes(tsAbsolute)) throw new Error("TS media proxy was never requested");
    if (hlsAbsolute && requests.includes(hlsAbsolute)) {
      throw new Error("broken HLS proxy was requested before the probed TS source");
    }
    if (snapshot.terminal) {
      throw new Error(`player entered ${snapshot.terminal}: ${snapshot.terminalText}`);
    }

    console.log(JSON.stringify({
      browser: name,
      probe: { protocol: probe.protocol, codecs: probe.codecs, playable: probe.playable },
      channel: { streamId: selected.streamId, name: selected.name },
      snapshot,
      consoleErrors: consoleErrors.slice(0, 8),
      failedRequests: failedRequests.slice(0, 8),
    }, null, 2));
  } finally {
    await browser.close();
  }
}

const iphone = devices["iPhone 15 Pro"] || devices["iPhone 14 Pro"] || {};
await verify("chromium", chromium, { viewport: { width: 390, height: 844 } });
await verify("webkit-iphone", webkit, iphone);
console.log("✓ premium IPTV watch path is responsive and TS-first in Chromium + WebKit");
