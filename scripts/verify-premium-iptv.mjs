#!/usr/bin/env node
import { chromium, devices, webkit } from "playwright";

const MATCH_ID = "espn-esp.1-401882867";
const HOME = "https://korazero.com/";
const TARGET = process.argv[2] ||
  `https://korazero.com/watch.html?ch=bein-sports-2&match=${MATCH_ID}&source=xtream&portal=lab&stream=2454&premium=1&premiumChannelId=bein-sports-2`;

function sameDestination(actual, expected) {
  return actual.origin === expected.origin
    && actual.pathname === expected.pathname
    && actual.search === expected.search;
}

function isExpectedNavigation(request, expected) {
  if (!request.isNavigationRequest()) return false;
  try {
    return sameDestination(new URL(request.url()), expected);
  } catch {
    return false;
  }
}

async function openHomepage(page, marker) {
  const response = await page.goto(`${HOME}?${marker}=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  if (!response?.ok()) throw new Error(`homepage navigation HTTP ${response?.status()}`);
  await page.waitForFunction(() => Boolean(document.getElementById("match-card-click-style")), null, {
    timeout: 30000,
  });
}

async function injectCard(page, { id, originalHref, premiumHref = null }) {
  await page.evaluate(({ id: cardId, originalHref: original, premiumHref: premium }) => {
    document.getElementById(cardId)?.remove();
    const card = document.createElement("article");
    card.id = cardId;
    card.className = "match-card";
    const source = premium
      ? `<div class="watch-source-toggle iptv-premium-test-toggle">
          <div class="watch-source-toggle__track">
            <a class="watch-source-toggle__opt watch-source-toggle__opt--premium"
               data-iptv-premium-test="1" href="${premium}">Premium</a>
            <a class="watch-source-toggle__opt watch-source-toggle__opt--original"
               href="${original}">Original</a>
          </div>
        </div>`
      : `<a class="watch-link" href="${original}">Watch</a>`;
    card.innerHTML = `
      <div class="teams" data-pw-card-body="1">
        <div class="team"><span class="tname">PW Home</span></div>
        <div class="team"><span class="tname">PW Away</span></div>
      </div>
      <div class="match-foot">${source}</div>`;
    (document.getElementById("matches-grid") || document.body).appendChild(card);
  }, { id, originalHref, premiumHref });

  await page.waitForFunction((cardId) => {
    const card = document.getElementById(cardId);
    return card?.dataset?.matchCardClickable === "1";
  }, id, { timeout: 10000 });
}

async function clickCardAndCaptureNavigation(page, card, expected) {
  const requestPromise = page.waitForRequest(
    (request) => isExpectedNavigation(request, expected),
    { timeout: 20000 },
  );
  await card.locator('[data-pw-card-body="1"]').click();
  const request = await requestPromise;
  return request.url();
}

async function verifyHomepageCard(name, browserType, contextOptions = {}) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    await openHomepage(page, "pw-normal-card");
    const realCardCount = await page.locator("#matches-grid .match-card").count();

    const normalOriginal = "/watch.html?ch=bein-sports-1&match=pw-normal-card";
    await injectCard(page, {
      id: "pw-normal-card",
      originalHref: normalOriginal,
    });
    const normalCard = page.locator("#pw-normal-card");
    const normalState = await normalCard.evaluate((node) => ({
      clickable: node.dataset.matchCardClickable,
      premium: node.dataset.iptvPremiumCard || null,
      classes: node.className,
    }));
    if (normalState.clickable !== "1") throw new Error(`normal card was not marked clickable: ${JSON.stringify(normalState)}`);
    const normalExpected = new URL(normalOriginal, HOME);
    const normalNavigation = await clickCardAndCaptureNavigation(page, normalCard, normalExpected);

    await openHomepage(page, "pw-premium-card");
    const premiumOriginal = "/watch.html?ch=bein-sports-2&match=pw-premium-card";
    const premiumTarget =
      "/watch.html?ch=bein-sports-2&match=pw-premium-card&source=xtream&portal=lab&stream=2454&premium=1&premiumChannelId=bein-sports-2";
    await injectCard(page, {
      id: "pw-premium-card",
      originalHref: premiumOriginal,
      premiumHref: premiumTarget,
    });
    await page.waitForFunction(() => document.getElementById("pw-premium-card")?.dataset?.iptvPremiumCard === "1");
    const premiumCard = page.locator("#pw-premium-card");
    const premiumState = await premiumCard.evaluate((node) => ({
      clickable: node.dataset.matchCardClickable,
      premium: node.dataset.iptvPremiumCard || null,
      classes: node.className,
      premiumHref: node.querySelector('[data-iptv-premium-test="1"]')?.href || null,
      originalHref: node.querySelector(".watch-source-toggle__opt--original")?.href || null,
    }));
    if (premiumState.clickable !== "1" || premiumState.premium !== "1") {
      throw new Error(`premium card markers are wrong: ${JSON.stringify(premiumState)}`);
    }
    const premiumExpected = new URL(premiumTarget, HOME);
    const premiumNavigation = await clickCardAndCaptureNavigation(page, premiumCard, premiumExpected);

    console.log(JSON.stringify({
      browser: name,
      deployedCardHandler: "pass",
      realProductionCardCountBeforeFixture: realCardCount,
      normalCard: normalState,
      premiumCard: premiumState,
      normalNavigation,
      premiumNavigation,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

async function verifyWatch(name, browserType, contextOptions = {}) {
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
      watchPath: "pass",
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
await verifyHomepageCard("chromium", chromium, { viewport: { width: 390, height: 844 } });
await verifyHomepageCard("webkit-iphone", webkit, iphone);
await verifyWatch("chromium", chromium, { viewport: { width: 390, height: 844 } });
await verifyWatch("webkit-iphone", webkit, iphone);
console.log("✓ deployed card-body navigation + premium TS-first watch path pass in Chromium + WebKit");
