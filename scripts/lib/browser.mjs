/**
 * Browser launchers for automation scripts.
 *
 * Stealth (real Chrome fingerprint, CDP patches):
 *   https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs
 *
 * Alternatives (not wired here):
 *   https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth
 *   https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra
 *   https://github.com/ultrafunkamsterdam/nodriver (Python, no Playwright shim)
 */
import { chromium as playwrightChromium } from "playwright-core";
import { existsSync } from "node:fs";

const SYSTEM_CHROME = "/usr/local/bin/google-chrome";

export function chromeExecutable() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  if (existsSync(SYSTEM_CHROME)) return SYSTEM_CHROME;
  return undefined;
}

export async function loadPatchright() {
  const mod = await import("patchright");
  return mod.chromium;
}

/** Vanilla Playwright — verify/capture scripts. */
export async function launchBrowser(options = {}) {
  const executablePath = options.executablePath ?? chromeExecutable();
  const headless = options.headless !== false;
  return playwrightChromium.launch({
    headless,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      ...(options.args || []),
    ],
  });
}

/**
 * Patchright persistent context — real Google Chrome TLS + anti-detect CDP patches.
 * Do not set custom userAgent (Patchright best practice).
 */
export async function launchStealthContext(userDataDir, options = {}) {
  const chromium = await loadPatchright();
  const headful = process.env.HEADFUL === "1" || options.headful === true;
  const hasChrome = !!chromeExecutable();
  // Patchright: real Chrome + non-headless passes Twitch signup/login checks
  const useHeadless = headful ? false : options.headless === true;
  return chromium.launchPersistentContext(userDataDir, {
    ...(hasChrome ? { channel: "chrome" } : { executablePath: chromeExecutable() }),
    headless: useHeadless,
    viewport: headful ? null : { width: 1280, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
}

export async function dismissCookieBanner(page) {
  const proceed = page.getByRole("button", { name: /^Proceed$/i }).first();
  if (await proceed.isVisible({ timeout: 2000 }).catch(() => false)) {
    await proceed.click();
    await page.waitForTimeout(500);
  }
}

export function stealthEnabled() {
  return process.env.STEALTH === "1" || process.env.PATCHRIGHT === "1";
}

export async function crawleeLaunchContext() {
  const headful = process.env.HEADFUL === "1";
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];

  if (stealthEnabled()) {
    const chromium = await loadPatchright();
    const hasChrome = !!chromeExecutable();
    return {
      launcher: chromium,
      launchOptions: {
        ...(hasChrome ? { channel: "chrome" } : { executablePath: chromeExecutable() }),
        headless: headful ? false : true,
        args,
      },
    };
  }

  const executablePath = chromeExecutable();
  return {
    launcher: playwrightChromium,
    launchOptions: {
      headless: headful ? false : true,
      ...(executablePath ? { executablePath } : {}),
      args,
    },
  };
}
