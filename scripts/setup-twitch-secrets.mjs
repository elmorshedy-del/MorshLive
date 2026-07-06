#!/usr/bin/env node
/**
 * Push Twitch Helix credentials to the morshlive worker.
 *
 * 1. Create an app once: https://dev.twitch.tv/console/apps
 *    - Name: KoraZero
 *    - OAuth redirect: https://korazero.com
 *    - Category: Website Integration
 * 2. Copy Client ID + generate Client Secret
 * 3. Add to .env (gitignored):
 *      TWITCH_CLIENT_ID=...
 *      TWITCH_CLIENT_SECRET=...
 * 4. Run: node scripts/setup-twitch-secrets.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}

loadDotEnv();

const clientId = process.env.TWITCH_CLIENT_ID || "";
const clientSecret = process.env.TWITCH_CLIENT_SECRET || "";

if (!clientId || !clientSecret) {
  console.error("Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET in environment / .env");
  console.error("Create an app at https://dev.twitch.tv/console/apps then add both values to .env");
  process.exit(1);
}

async function verifyHelix() {
  const tokenRes = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`,
    { method: "POST" }
  );
  if (!tokenRes.ok) {
    console.error("Helix token failed:", tokenRes.status, await tokenRes.text());
    process.exit(1);
  }
  const { access_token: token } = await tokenRes.json();
  const streamsRes = await fetch("https://api.twitch.tv/helix/streams?first=1", {
    headers: { "Client-ID": clientId, Authorization: `Bearer ${token}` },
  });
  if (!streamsRes.ok) {
    console.error("Helix streams probe failed:", streamsRes.status, await streamsRes.text());
    process.exit(1);
  }
  console.log("✓ Helix client-credentials token works");
}

function putSecret(name, value) {
  const r = spawnSync("npx", ["wrangler", "secret", "put", name], {
    input: value,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (r.status !== 0) process.exit(r.status || 1);
  console.log(`✓ wrangler secret put ${name}`);
}

await verifyHelix();
putSecret("TWITCH_CLIENT_ID", clientId);
putSecret("TWITCH_CLIENT_SECRET", clientSecret);
console.log("\nDone. Probe: node scripts/probe-twitch-resolve.js https://korazero.com vip1 bein-max-1");
