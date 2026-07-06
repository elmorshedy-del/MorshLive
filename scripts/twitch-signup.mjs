#!/usr/bin/env node
/**
 * Twitch signup assist — https://github.com/apify/crawlee + Playwright
 *
 * Twitch blocks headless/cloud signup ("browser not supported").
 * Run locally with a real browser:
 *   HEADFUL=1 npm run signup:twitch
 *
 * Env (optional):
 *   TWITCH_SIGNUP_EMAIL=darkmatter1339@gmail.com
 *   TWITCH_SIGNUP_USERNAME=korazero_dm1339
 *   TWITCH_LOGIN_PASSWORD=...  (auto-generated if missing)
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./lib/browser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SHOTS = process.env.CRAWL_SHOTS || "/opt/cursor/artifacts/twitch-signup";
mkdirSync(SHOTS, { recursive: true });

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

saveEnv({
  TWITCH_SIGNUP_EMAIL: EMAIL,
  TWITCH_SIGNUP_USERNAME: USERNAME,
  TWITCH_LOGIN_EMAIL: EMAIL,
  TWITCH_LOGIN_PASSWORD: PASSWORD,
});

const headless = process.env.HEADFUL !== "1";
console.log("Twitch signup:", EMAIL, USERNAME, headless ? "(headless)" : "(HEADFUL)");

const browser = await launchBrowser({ headless });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 900 },
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});
const page = await context.newPage();

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

const unsupported = await page.locator("text=browser is not currently supported").count();
if (unsupported) {
  console.warn("\n⚠ Twitch says browser unsupported (common in headless cloud).");
  console.warn("Run on your Mac/PC: HEADFUL=1 npm run signup:twitch");
  console.warn("Credentials saved in .env — use same email/username/password there.");
}

if (!headless) {
  console.log("\nComplete Sign Up in the browser window, then verify email at", EMAIL);
  console.log("Press Enter here after verification...");
  await new Promise((r) => process.stdin.once("data", r));
} else {
  await page.getByRole("button", { name: /^Sign Up$/i }).click().catch(() => {});
  await page.waitForTimeout(8000);
  await page.screenshot({ path: resolve(SHOTS, "after-submit.png"), fullPage: true });
  const body = await page.locator("body").innerText();
  if (/verify|check your email|sent you/i.test(body)) {
    console.log("✓ Verification email likely sent — check", EMAIL);
  } else if (/browser is not currently supported/i.test(body)) {
    console.log("✗ Signup blocked in this environment. Use HEADFUL=1 locally.");
  } else {
    console.log("URL:", page.url());
    console.log(body.slice(0, 500).replace(/\s+/g, " "));
  }
}

await browser.close();
console.log("\nNext: verify inbox → npm run crawl:twitch-dev → create KoraZero app → npm run twitch:secrets");
