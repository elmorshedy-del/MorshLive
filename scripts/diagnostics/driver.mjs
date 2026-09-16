/**
 * KoraZero Diagnostics — the browser driver.
 *
 * Drives a real Chromium against the harness the way a person would: a device
 * profile (phone or desktop), an optional network profile, a URL, a dwell
 * time, then read the probe.
 *
 * CDN scripts (mpegts.js, hls.js) are fetched by Node and fulfilled into the
 * page for the same TLS reason the harness exists. Without this the player
 * library never loads and every run looks like a total failure.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROBE = fs.readFileSync(path.join(HERE, "probe.js"), "utf8");

/** Rough downlink/latency shapes. Applied through CDP before the page loads. */
export const NETWORKS = {
  wifi: { downloadThroughput: (30 * 1024 * 1024) / 8, uploadThroughput: (10 * 1024 * 1024) / 8, latency: 10 },
  "4g": { downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8, latency: 60 },
  "3g": { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 300 },
  none: null,
};

async function loadPlaywright() {
  for (const spec of ["playwright", "/opt/node22/lib/node_modules/playwright/index.mjs"]) {
    try {
      return await import(spec);
    } catch {
      /* try the next location */
    }
  }
  throw new Error("Playwright not found. Install it, or run where it is available.");
}

/**
 * Playwright expects a browser build matching its own version. Where a browser
 * is provisioned separately from the npm package — a prepared container, a
 * pinned image — those versions drift and the default launch fails even though
 * a perfectly good Chromium is sitting on disk. Try the normal path, then the
 * known location, before giving up.
 */
async function launchChromium(chromium) {
  const candidates = [undefined, process.env.KZ_DIAG_CHROMIUM, "/opt/pw-browsers/chromium"].filter(
    (p, i) => i === 0 || Boolean(p),
  );
  let lastError;
  for (const executablePath of candidates) {
    try {
      return await chromium.launch(executablePath ? { executablePath } : {});
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Could not launch Chromium. Tried the Playwright default and ${candidates.filter(Boolean).join(", ")}.\n` +
      `Set KZ_DIAG_CHROMIUM to a browser binary, or run "npx playwright install chromium".\n` +
      `Last error: ${lastError?.message}`,
  );
}

export async function drive({
  origin,
  urlPath,
  seconds = 45,
  device = "desktop",
  network = "none",
  onTick = null,
}) {
  const { chromium, devices } = await loadPlaywright();
  const browser = await launchChromium(chromium);

  const profile = device === "desktop" ? { viewport: { width: 1280, height: 800 } } : devices[device];
  if (!profile) {
    await browser.close();
    throw new Error(`Unknown device "${device}". Try "desktop" or a Playwright descriptor like "iPhone 13".`);
  }

  // A fresh context each run: a warm cache would hide the startup cost.
  const context = await browser.newContext(profile);
  const page = await context.newPage();

  const netFailures = [];
  const httpErrors = [];
  page.on("requestfailed", (r) => netFailures.push(`${r.failure()?.errorText} ${r.url().slice(0, 90)}`));
  page.on("response", (r) => {
    if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.url().replace(origin, "").slice(0, 90)}`);
  });

  // Player libraries come from a CDN the sandboxed browser cannot reach.
  await page.route("**://cdn.jsdelivr.net/**", async (route) => {
    try {
      const upstream = await fetch(route.request().url());
      route.fulfill({
        status: upstream.status,
        body: Buffer.from(await upstream.arrayBuffer()),
        headers: { "content-type": "application/javascript" },
      });
    } catch {
      route.abort();
    }
  });
  // Fonts and analytics add noise and nothing else.
  for (const pattern of ["**://fonts.googleapis.com/**", "**://fonts.gstatic.com/**", "**://www.googletagmanager.com/**"]) {
    await page.route(pattern, (r) => r.abort());
  }

  if (NETWORKS[network]) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NETWORKS[network] });
  }

  await page.addInitScript(PROBE);
  await page.goto(origin + urlPath, { waitUntil: "domcontentloaded", timeout: 45000 });

  const step = 5;
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    await page.waitForTimeout(Math.min(step, seconds - elapsed) * 1000);
    if (onTick) {
      const snap = await page.evaluate(() => window.__KZ_DIAG?.() ?? null).catch(() => null);
      onTick(elapsed + step, snap);
    }
  }

  const probe = await page.evaluate(() => window.__KZ_DIAG?.() ?? null).catch(() => null);
  const dom = await page
    .evaluate(() => ({
      title: document.title,
      channelName: document.getElementById("ch-name")?.textContent?.trim() || null,
      toolbar: document.getElementById("player-toolbar")?.innerText?.replace(/\s+/g, " ").trim() || null,
      hasGoldToggle: !!document.querySelector(".watch-source-toggle, .premium-source-tabs"),
      videoPresent: !!document.querySelector("video"),
      mpegtsLoaded: typeof window.mpegts,
    }))
    .catch(() => null);

  await browser.close();
  return { probe, dom, netFailures: [...new Set(netFailures)], httpErrors: [...new Set(httpErrors)] };
}
