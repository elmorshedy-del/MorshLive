#!/usr/bin/env node
/**
 * Crawl Twitch Developer Console using Crawlee (https://github.com/apify/crawlee)
 * + Playwright (https://github.com/microsoft/playwright).
 *
 * Goal: reach the apps list, screenshot steps, reuse saved session if present.
 *
 * Usage:
 *   npm run browsers:install
 *   TWITCH_LOGIN_EMAIL=you@example.com npm run crawl:twitch-dev
 *
 * Optional: HEADFUL=1 for visible browser (local). Saves session under .auth/twitch-dev/
 *
 * After login + app create, copy Client ID/Secret to .env and run:
 *   node scripts/setup-twitch-secrets.mjs
 */
import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PlaywrightCrawler, Dataset } from "crawlee";
import { crawleeLaunchContext } from "./lib/browser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const AUTH_DIR = resolve(ROOT, ".auth/twitch-dev");
const SHOTS = process.env.CRAWL_SHOTS || "/opt/cursor/artifacts/twitch-dev";
const EMAIL = process.env.TWITCH_LOGIN_EMAIL || "";

mkdirSync(AUTH_DIR, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const START_URLS = [
  "https://dev.twitch.tv/console/apps",
  "https://dev.twitch.tv/console/apps/create",
];

async function snap(page, name) {
  const path = resolve(SHOTS, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log("screenshot:", path);
  return path;
}

const crawler = new PlaywrightCrawler({
  maxRequestsPerCrawl: 6,
  maxConcurrency: 1,
  requestHandlerTimeoutSecs: 120,
  launchContext: {
    ...crawleeLaunchContext(),
    userDataDir: AUTH_DIR,
  },
  async requestHandler({ page, request, log }) {
    const url = page.url();
    log.info(`Page: ${url}`);

    await page.waitForTimeout(2000);
    await snap(page, `step-${Date.now()}`);

    if (/dev\.twitch\.tv\/login/i.test(url) || /id\.twitch\.tv/i.test(url)) {
      log.warning("Login required — Twitch needs password + 2FA (email alone is not enough).");
      const userInput = page.locator("#login-username, input[name='username'], input[type='text']").first();
      if (EMAIL && (await userInput.count())) {
        await userInput.fill(EMAIL);
        log.info(`Prefilled email/username: ${EMAIL}`);
        await snap(page, "login-email-filled");
      }
      await Dataset.pushData({
        step: "login_required",
        url,
        emailPrefilled: !!EMAIL,
        hint: "Set HEADFUL=1, run again, enter password in browser, then re-run to reuse .auth/twitch-dev session",
      });
      return;
    }

    if (/console\/apps\/create/i.test(url)) {
      const nameInput = page.locator("input[name='name'], input#name, input[placeholder*='name' i]").first();
      if (await nameInput.count()) {
        await nameInput.fill("KoraZero");
      }
      const redirect = page.locator("input[name='oauth_redirect_uri'], input#oauth_redirect_uri, input[placeholder*='redirect' i]").first();
      if (await redirect.count()) {
        await redirect.fill("https://korazero.com");
      }
      await snap(page, "create-app-form");
      await Dataset.pushData({
        step: "create_app_form",
        url,
        hint: "Submit form in browser (HEADFUL=1), then copy Client ID + Secret to .env",
      });
      return;
    }

    if (/console\/apps/i.test(url)) {
      const body = await page.locator("body").innerText();
      const clientIdMatch = body.match(/Client ID[:\s]+([a-z0-9]{30})/i);
      await snap(page, "apps-list");
      await Dataset.pushData({
        step: "apps_console",
        url,
        clientIdVisible: clientIdMatch ? clientIdMatch[1] : null,
        loggedIn: !/log in/i.test(body),
      });
      if (clientIdMatch) {
        console.log("\nFound Client ID on page:", clientIdMatch[1]);
        console.log("Add TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET to .env → node scripts/setup-twitch-secrets.mjs");
      }
    }
  },
});

console.log("Crawlee + Playwright → Twitch Developer Console");
console.log("Session dir:", AUTH_DIR);
console.log("Screenshots:", SHOTS);
if (EMAIL) console.log("Login email:", EMAIL);

await crawler.run(START_URLS);

const items = await Dataset.getData();
console.log("\nCrawl summary:", JSON.stringify(items.items, null, 2));
