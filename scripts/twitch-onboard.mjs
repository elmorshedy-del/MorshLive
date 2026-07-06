#!/usr/bin/env node
/**
 * Full Twitch onboarding: signup/login → dev console → Helix credentials → wrangler secrets.
 *
 *   npm run browsers:stealth
 *   npm run twitch:onboard
 *
 * Env (.env): TWITCH_LOGIN_EMAIL, TWITCH_LOGIN_PASSWORD, TWITCH_SIGNUP_USERNAME
 * Optional: HEADFUL=1, SUBMIT_SIGNUP=1
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchStealthContext } from "./lib/browser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const AUTH_DIR = resolve(ROOT, ".auth/twitch-dev");
const SHOTS = process.env.CRAWL_SHOTS || "/opt/cursor/artifacts/twitch-onboard";
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

function saveEnvKey(key, value) {
  const path = resolve(ROOT, ".env");
  let lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  lines = lines.filter((l) => !new RegExp(`^${key}=`).test(l));
  lines.push(`${key}=${value}`);
  writeFileSync(path, lines.filter(Boolean).join("\n") + "\n");
}

async function snap(page, name) {
  const path = resolve(SHOTS, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log("screenshot:", path);
}

const env = loadEnv();
const EMAIL = process.env.TWITCH_LOGIN_EMAIL || env.TWITCH_LOGIN_EMAIL || "";
const PASSWORD = process.env.TWITCH_LOGIN_PASSWORD || env.TWITCH_LOGIN_PASSWORD || "";
const USERNAME = process.env.TWITCH_SIGNUP_USERNAME || env.TWITCH_SIGNUP_USERNAME || "";
const headful = process.env.HEADFUL === "1";

if (!EMAIL || !PASSWORD) {
  console.error("Need TWITCH_LOGIN_EMAIL and TWITCH_LOGIN_PASSWORD in .env");
  process.exit(1);
}

console.log("Twitch onboard:", EMAIL, headful ? "HEADFUL" : "headless");

const context = await launchStealthContext(AUTH_DIR, { headful });
const page = context.pages()[0] || await context.newPage();

async function tryLogin(loginId = USERNAME || EMAIL) {
  await page.goto("https://www.twitch.tv/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  await snap(page, "login-1");

  const cookieProceed = page.getByRole("button", { name: /^Proceed$/i }).first();
  if (await cookieProceed.isVisible().catch(() => false)) await cookieProceed.click();

  const userInput = page.locator("#login-username, input[name='username'], input[autocomplete='username']").first();
  const passInput = page.locator("#password-input, input[name='password'], input[type='password']").first();

  await userInput.fill(loginId);
  await passInput.fill(PASSWORD);
  await snap(page, "login-filled");
  await page.getByRole("button", { name: /^Log In$/i }).click();
  await page.waitForTimeout(8000);
  await snap(page, "login-after");

  const body = await page.locator("body").innerText();
  if (/disabled the ability to log in with your email/i.test(body) && loginId.includes("@") && USERNAME) {
    console.log("Email login disabled — retrying with username:", USERNAME);
    return tryLogin(USERNAME);
  }
  if (/incorrect|invalid|wrong password|does not exist/i.test(body)) return false;
  if (/verify|two-factor|2fa|authentication code/i.test(body)) {
    console.warn("2FA / verification step");
    if (headful) {
      console.log("Waiting 120s for manual 2FA...");
      await page.waitForTimeout(120000);
    } else return false;
  }
  return !/\/login/.test(page.url()) || await page.locator("[data-a-target='user-menu-toggle'], button[data-testid='user-menu-toggle']").isVisible().catch(() => false);
}

async function trySignup() {
  console.log("Trying signup...");
  await page.goto("https://www.twitch.tv/signup", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator("#email-input").fill(EMAIL);
  await page.getByRole("button", { name: /^Continue$/i }).click();
  await page.waitForTimeout(3000);

  const taken = await page.locator("body").innerText();
  if (/already registered|already in use|account exists/i.test(taken)) {
    console.log("Email already registered — use login");
    return false;
  }

  if (USERNAME) await page.locator("#signup-username").fill(USERNAME);
  await page.locator("#password-input").fill(PASSWORD);
  await page.locator("select").nth(0).selectOption("January");
  await page.locator("select").nth(1).selectOption("15");
  await page.locator("select").nth(2).selectOption("1990");
  await snap(page, "signup-filled");

  if (process.env.SUBMIT_SIGNUP !== "0") {
    await page.getByRole("button", { name: /^Sign Up$/i }).click();
    await page.waitForTimeout(8000);
    await snap(page, "signup-after");
    const body = await page.locator("body").innerText();
    if (/verify|check your email/i.test(body)) {
      console.log("✓ Signup submitted — verification email sent to", EMAIL);
      return "pending_verify";
    }
  }
  return true;
}

async function openDevConsole() {
  await page.goto("https://dev.twitch.tv/console/apps", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  await snap(page, "dev-apps");

  const loginWithTwitch = page.getByRole("button", { name: /login with twitch/i }).first();
  if (await loginWithTwitch.isVisible().catch(() => false)) {
    await loginWithTwitch.click();
    await page.waitForTimeout(8000);
    await snap(page, "dev-oauth");
  }

  if (/id\.twitch\.tv|login/i.test(page.url())) {
    const userInput = page.locator("#login-username, input[name='username']").first();
    const passInput = page.locator("#password-input, input[name='password'], input[type='password']").first();
    if (await userInput.isVisible().catch(() => false)) {
      await userInput.fill(USERNAME || EMAIL);
      await passInput.fill(PASSWORD);
      const proceed = page.getByRole("button", { name: /^Proceed$/i }).first();
      if (await proceed.isVisible().catch(() => false)) await proceed.click();
      await page.getByRole("button", { name: /^Log In$/i }).click();
      await page.waitForTimeout(8000);
      await snap(page, "dev-login-after");
    }
    const authorize = page.getByRole("button", { name: /authorize|accept|continue/i }).first();
    if (await authorize.isVisible().catch(() => false)) {
      await authorize.click();
      await page.waitForTimeout(5000);
    }
    await page.goto("https://dev.twitch.tv/console/apps", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
    await snap(page, "dev-apps-after-login");
  }
}

async function ensureApp() {
  const body = await page.locator("body").innerText();
  const clientIdMatch = body.match(/Client ID[:\s\n]+([a-z0-9]{30})/i);
  if (clientIdMatch) {
    console.log("Found existing Client ID:", clientIdMatch[1]);
    return { clientId: clientIdMatch[1], clientSecret: null };
  }

  await page.goto("https://dev.twitch.tv/console/apps/create", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  await snap(page, "create-app");

  const nameInput = page.locator("input[name='name'], input#name").first();
  if (await nameInput.isVisible().catch(() => false)) {
    await nameInput.fill("KoraZero");
    const redirect = page.locator("input[name='oauth_redirect_uri'], input#oauth_redirect_uri").first();
    if (await redirect.isVisible().catch(() => false)) await redirect.fill("https://korazero.com");
    const category = page.locator("select, [role='combobox']").first();
    if (await category.isVisible().catch(() => false)) {
      await category.click().catch(() => {});
      await page.getByText(/website integration/i).first().click().catch(() => {});
    }
    await snap(page, "create-app-filled");
    const createBtn = page.getByRole("button", { name: /create|register|submit/i }).first();
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(5000);
      await snap(page, "create-app-done");
    }
  }

  const afterBody = await page.locator("body").innerText();
  const idMatch = afterBody.match(/Client ID[:\s\n]+([a-z0-9]{30})/i);
  return { clientId: idMatch?.[1] || null, clientSecret: null };
}

async function generateSecret() {
  const newSecretBtn = page.getByRole("button", { name: /new secret|generate|client secret/i }).first();
  if (await newSecretBtn.isVisible().catch(() => false)) {
    await newSecretBtn.click();
    await page.waitForTimeout(3000);
    await snap(page, "new-secret");
  }
  const body = await page.locator("body").innerText();
  const secretMatch = body.match(/Client Secret[:\s\n]+([a-z0-9]{30})/i);
  return secretMatch?.[1] || null;
}

let loggedIn = await tryLogin(USERNAME || EMAIL);
if (!loggedIn) {
  const signupResult = await trySignup();
  if (signupResult === "pending_verify") {
    console.log("\n⚠ Account needs email verification at", EMAIL, "— cannot finish dev app until verified.");
    await context.close();
    process.exit(2);
  }
  loggedIn = await tryLogin(USERNAME || EMAIL);
}

if (!loggedIn) {
  console.error("Could not log in. Check password or verify email.");
  await snap(page, "login-failed");
  await context.close();
  process.exit(1);
}

console.log("✓ Logged in to Twitch");
await openDevConsole();

const { clientId } = await ensureApp();
if (!clientId) {
  console.error("Could not find or create Client ID — check screenshots in", SHOTS);
  await context.close();
  process.exit(1);
}

saveEnvKey("TWITCH_CLIENT_ID", clientId);
console.log("✓ Saved TWITCH_CLIENT_ID to .env");

const clientSecret = await generateSecret();
if (clientSecret) {
  saveEnvKey("TWITCH_CLIENT_SECRET", clientSecret);
  console.log("✓ Saved TWITCH_CLIENT_SECRET to .env");
} else {
  console.warn("Could not auto-read Client Secret — generate manually on dev console, add to .env, re-run npm run twitch:secrets");
}

await context.close();

if (clientSecret) {
  const r = spawnSync("npm", ["run", "twitch:secrets"], { cwd: ROOT, stdio: "inherit", env: process.env });
  process.exit(r.status || 0);
}

console.log("\nAdd TWITCH_CLIENT_SECRET to .env then: npm run twitch:secrets");
