#!/usr/bin/env node
/**
 * Twitch signup via Patchright (undetected Playwright + real Chrome fingerprint)
 * https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs
 *
 *   npm run browsers:stealth
 *   HEADFUL=1 npm run signup:twitch          # required — Twitch blocks headless submit
 *   STEALTH=0 npm run signup:twitch          # vanilla Playwright (will fail)
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, launchStealthContext, dismissCookieBanner } from "./lib/browser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const AUTH_DIR = resolve(ROOT, ".auth/twitch-signup");
const SHOTS = process.env.CRAWL_SHOTS || "/opt/cursor/artifacts/twitch-signup";
mkdirSync(SHOTS, { recursive: true });
mkdirSync(AUTH_DIR, { recursive: true });

function loadEnv() {
  const path = resolve(ROOT, ".env");
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

function saveEnv(vars) {
  const path = resolve(ROOT, ".env");
  let lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  lines = lines.filter((l) => !/^TWITCH_(SIGNUP_|LOGIN_)/.test(l));
  for (const [k, v] of Object.entries(vars)) lines.push(`${k}=${v}`);
  writeFileSync(path, lines.filter(Boolean).join("\n") + "\n");
}

const env = loadEnv();
const EMAIL = process.env.TWITCH_SIGNUP_EMAIL || env.TWITCH_SIGNUP_EMAIL || "darkmatter1339@gmail.com";
const USERNAME = process.env.TWITCH_SIGNUP_USERNAME || env.TWITCH_SIGNUP_USERNAME || "korazero_dm1339";
const PASSWORD = process.env.TWITCH_LOGIN_PASSWORD || env.TWITCH_LOGIN_PASSWORD || `Kz${randomBytes(12).toString("base64url")}!7`;
const USE_STEALTH = process.env.STEALTH !== "0";
// Twitch rejects headless submit — default headful when DISPLAY is available
const headful = process.env.HEADFUL === "1" || (!process.env.HEADFUL && !!process.env.DISPLAY);

saveEnv({
  TWITCH_SIGNUP_EMAIL: EMAIL,
  TWITCH_SIGNUP_USERNAME: USERNAME,
  TWITCH_LOGIN_EMAIL: EMAIL,
  TWITCH_LOGIN_PASSWORD: PASSWORD,
});

console.log("Twitch signup:", EMAIL, USERNAME, USE_STEALTH ? "[Patchright]" : "[playwright]", headful ? "HEADFUL" : "headless");

let browser;
let context;
let page;
let closeable;

if (USE_STEALTH) {
  context = await launchStealthContext(AUTH_DIR, { headful });
  page = context.pages()[0] || await context.newPage();
  closeable = context;
} else {
  browser = await launchBrowser({ headless: !headful });
  context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  page = await context.newPage();
  closeable = browser;
}

await page.goto("https://www.twitch.tv/signup", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2000);
await dismissCookieBanner(page);

await page.locator("#email-input").fill(EMAIL);
await page.getByRole("button", { name: /^Continue$/i }).click();
await page.waitForTimeout(3000);
await dismissCookieBanner(page);

await page.locator("#signup-username").fill(USERNAME);
await page.locator("#password-input").fill(PASSWORD);
await page.locator("select").nth(0).selectOption("January");
await page.locator("select").nth(1).selectOption("15");
await page.locator("select").nth(2).selectOption("1990");
await page.screenshot({ path: resolve(SHOTS, "filled.png"), fullPage: true });

const bodyAfterFill = await page.locator("body").innerText();
if (/browser is not currently supported/i.test(bodyAfterFill)) {
  console.error("✗ Twitch blocked this browser. Run on your PC: HEADFUL=1 npm run signup:twitch");
  await closeable.close();
  process.exit(1);
}

async function clickSignUp() {
  const selectors = [
    'button[data-a-target="passport-signup-button"]',
    'button:has-text("Sign Up")',
    'form button[type="submit"]',
  ];
  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.scrollIntoViewIfNeeded();
      const disabled = await btn.isDisabled().catch(() => false);
      if (disabled) {
        console.warn("Sign Up button disabled — waiting for validation...");
        await page.waitForTimeout(2000);
      }
      await btn.click({ timeout: 10000 });
      return true;
    }
  }
  await page.getByRole("button", { name: /^Sign Up$/i }).click({ timeout: 10000 });
  return true;
}

const netLogs = [];
page.on("response", (r) => {
  if (r.status() === 429) netLogs.push(`429 ${r.url()}`);
});

try {
  await clickSignUp();
} catch (err) {
  console.error("✗ Could not click Sign Up:", err.message);
  await page.screenshot({ path: resolve(SHOTS, "submit-failed.png"), fullPage: true });
  if (!headful) {
    console.error("\nTwitch requires a real visible browser to submit signup.");
    console.error("On your computer, clone the repo and run:");
    console.error("  HEADFUL=1 npm run signup:twitch");
  }
  await closeable.close();
  process.exit(1);
}

await page.waitForTimeout(10000);
await page.screenshot({ path: resolve(SHOTS, "after-submit.png"), fullPage: true });

const body = await page.locator("body").innerText();
const url = page.url();

if (/verify|check your email|sent you|confirm your email/i.test(body)) {
  console.log("✓ Verification email sent to", EMAIL);
  console.log("  Open Gmail → click Twitch link → then run: npm run twitch:onboard");
} else if (/already registered|already in use|username.*taken/i.test(body)) {
  console.log("Account may already exist — try logging in at twitch.tv with username:", USERNAME);
} else if (/browser is not currently supported/i.test(body)) {
  console.log("✗ Blocked on submit. Sign up manually at https://www.twitch.tv/signup");
  console.log("  Email:", EMAIL, "| Username:", USERNAME);
} else if (/\/signup\/email|verify/i.test(url)) {
  console.log("✓ On verification step — check", EMAIL);
} else {
  console.log("URL:", url);
  console.log("Page text:", body.slice(0, 600).replace(/\s+/g, " "));
  if (netLogs.length) console.log("Rate limited:", netLogs.join("; "));
  console.log("\n✗ No email because Twitch did not create the account from this server.");
  console.log("  Sign up manually on your phone/PC: https://www.twitch.tv/signup");
  console.log("  Email:", EMAIL, "| Username:", USERNAME);
}

if (headful && process.stdin.isTTY) {
  console.log("\nBrowser open — complete any remaining steps, then press Enter...");
  await new Promise((r) => process.stdin.once("data", r));
}

await closeable.close();
console.log("\nNext: verify inbox → npm run twitch:onboard → npm run twitch:secrets");
