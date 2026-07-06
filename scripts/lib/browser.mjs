/**
 * Shared browser launch — Playwright + optional system Chrome.
 * Used by verify/capture scripts and Crawlee crawlers.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const SYSTEM_CHROME = "/usr/local/bin/google-chrome";

export function chromeExecutable() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  if (existsSync(SYSTEM_CHROME)) return SYSTEM_CHROME;
  return undefined;
}

export async function launchBrowser(options = {}) {
  const executablePath = options.executablePath ?? chromeExecutable();
  const headless = options.headless !== false;
  return chromium.launch({
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

export function crawleeLaunchContext() {
  const executablePath = chromeExecutable();
  return {
    launcher: chromium,
    launchOptions: {
      headless: process.env.HEADFUL === "1" ? false : true,
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    },
  };
}
