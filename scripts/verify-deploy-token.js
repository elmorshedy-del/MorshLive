#!/usr/bin/env node
/**
 * Verify a Cloudflare API token can deploy the morshlive Worker.
 * Supports user-owned and account-owned (cfat_) tokens.
 * Usage: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/verify-deploy-token.js
 */
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const worker = process.env.CF_WORKER_NAME || "morshlive";

if (!token || !accountId) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

async function check(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

(async () => {
  const userVerify = await check("https://api.cloudflare.com/client/v4/user/tokens/verify");
  const accountVerify = await check(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`
  );

  const tokenOk =
    userVerify.ok ||
    accountVerify.ok ||
    (accountVerify.body && accountVerify.body.result && accountVerify.body.result.status === "active");

  if (!tokenOk) {
    console.error("Token invalid (user + account verify failed):");
    console.error("  user:", userVerify.body.errors || userVerify.status);
    console.error("  account:", accountVerify.body.errors || accountVerify.status);
    console.error("Tip: Account API tokens need account_id in wrangler.toml (set) and no IP filter on token.");
    process.exit(1);
  }

  const script = await check(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${worker}`
  );
  if (!script.ok && script.status !== 404) {
    console.error("Token cannot deploy Workers (needs Account → Workers Scripts → Edit):");
    console.error(script.body.errors || script.status);
    process.exit(1);
  }

  console.log(`OK — token can deploy Worker "${worker}"`);
})();
