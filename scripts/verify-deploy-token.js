#!/usr/bin/env node
/**
 * Verify a Cloudflare API token can deploy the morshlive Worker.
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
  const verify = await check("https://api.cloudflare.com/client/v4/user/tokens/verify");
  if (!verify.ok) {
    console.error("Token invalid:", verify.body.errors || verify.status);
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
