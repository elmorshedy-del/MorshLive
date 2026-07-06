#!/usr/bin/env node
/**
 * Check Cloudflare Workers Builds status and print dashboard setup link.
 * Full API setup needs a USER token with "Workers Builds Configuration Edit".
 * Account cfat_ tokens can deploy (wrangler) but cannot configure builds via API.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
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

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "f06dda0c02d25976dcda319e942e432c";
const token = process.env.CLOUDFLARE_API_TOKEN || "";
const configPath = resolve(process.cwd(), "config/cloudflare-workers-builds.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

async function cf(path, opts = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

console.log("MorshLive — Cloudflare Workers Builds setup\n");

const deployCheck = await cf(`/accounts/${accountId}/workers/scripts/morshlive`);
if (deployCheck.body?.success) {
  console.log("✓ API token can read Worker morshlive");
  console.log(`  tag: ${deployCheck.body.result?.tag || "?"}`);
} else {
  console.log("✗ Cannot read Worker — check CLOUDFLARE_API_TOKEN in .env");
}

const buildsCheck = await cf(`/accounts/${accountId}/builds/workers/${config.worker.tag}/triggers`);
if (buildsCheck.body?.success) {
  const triggers = buildsCheck.body.result || [];
  if (triggers.length) {
    console.log(`\n✓ Workers Builds triggers configured (${triggers.length}):`);
    for (const t of triggers) {
      console.log(`  - ${t.trigger_name}: branches ${JSON.stringify(t.branch_includes)}`);
    }
    console.log("\nMerge to main should auto-deploy via Cloudflare (not GitHub Actions).");
    process.exit(0);
  }
  console.log("\n○ Builds API reachable but no triggers yet.");
} else {
  const err = buildsCheck.body?.errors?.[0]?.message || buildsCheck.status;
  console.log(`\n○ Builds API: ${err}`);
  console.log("  (Account tokens often cannot manage builds — use Dashboard once.)");
}

console.log("\n── One-time Dashboard connect (no GitHub Actions billing) ──\n");
for (const step of config.dashboard_setup.steps) {
  console.log(`  • ${step}`);
}
console.log(`\n  ${config.dashboard_setup.url}\n`);
console.log("Production settings:");
console.log(`  build_command:  ${config.production_trigger.build_command}`);
console.log(`  deploy_command: ${config.production_trigger.deploy_command}`);
console.log("\nAfter connect: merge to main → Cloudflare builds → korazero.com updates.");
