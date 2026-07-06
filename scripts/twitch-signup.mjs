#!/usr/bin/env node
/**
 * Twitch signup via Patchright (undetected Playwright + real Chrome fingerprint)
 * https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs
 *
 *   npm run browsers:stealth
 *   npm run signup:twitch                    # Patchright by default
 *   STEALTH=0 npm run signup:twitch          # vanilla Playwright
 *   HEADFUL=1 npm run signup:twitch          # best for signup + email verify
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, launchStealthContext } from "./lib/browser.mjs";

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

saveEnv({
  TWITCH_SIGNUP_EMAIL: EMAIL,
  TWITCH_SIGNUP_USERNAME: USERNAME,
  TWITCH_LOGIN_EMAIL: EMAIL,
  TWITCH_LOGIN_PASSWORD: PASSWORD,
});

const headful = process.env.HEADFUL === "1";
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
await page.locator("#email-input").fill(EMAIL);
await page.getByRole("button", { name: /^Continue$/i }).click();
await page.waitForTimeout(3000);
await page.locator("#signup-username").fill(USERNAME);
await page.locator("#password-input").fill(PASSWORD);
await page.locator("select").nth(0).selectOption("January");
await page.locator("select").nth(1).selectOption("15");
await page.locator("select").nth(2).selectOption("1990");
await page.screenshot({ path: resolve(SHOTS, "filled.png"), fullPage: true });

const bodyAfterFill = await page.locator("body").innerText();
const unsupported = /browser is not currently supported/i.test(bodyAfterFill);
if (unsupported) {
  console.warn("\n⚠ Twitch still reports unsupported browser.");
  if (!USE_STEALTH) console.warn("Retry with: npm run signup:twitch (Patchright is default)");
  if (!headful) console.warn("Or locally: HEADFUL=1 npm run signup:twitch");
}

if (headful) {
  console.log("\nComplete Sign Up in the browser, verify email at", EMAIL);
  console.log("Press Enter when done...");
  await new Promise((r) => process.stdin.once("data", r));
} else {
  await page.getByRole("button", { name: /^Sign Up$/i }).click().catch(() => {});
  await page.waitForTimeout(8000);
  await page.screenshot({ path: resolve(SHOTS, "after-submit.png"), fullPage: true });
  const body = await page.locator("body").innerText();
  if (/verify|check your email|sent you/i.test(body)) {
    console.log("✓ Verification email likely sent — check", EMAIL);
  } else if (/browser is not currently supported/i.test(body)) {
    console.log("✗ Blocked. Use HEADFUL=1 on a real machine.");
  } else {
    console.log("URL:", page.url());
    console.log(body.slice(0, 500).replace(/\s+/g, " "));
  }
}

await closeable.close();
console.log("\nNext: verify inbox → STEALTH=1 npm run crawl:twitch-dev → npm run twitch:secrets");
