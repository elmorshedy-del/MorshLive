#!/usr/bin/env node
/**
 * Verify a Cloudflare API token can deploy to Pages (needs upload-token access).
 * Usage: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/verify-deploy-token.js
 */
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const project = process.env.CF_PAGES_PROJECT || "korazero";

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
  const verify = await check(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`);
  if (!verify.ok) {
    console.error("Token invalid:", verify.body.errors || verify.status);
    process.exit(1);
  }

  const upload = await check(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project}/upload-token`
  );
  if (!upload.ok) {
    console.error("Token cannot deploy (needs Account → Cloudflare Pages → Edit):");
    console.error(upload.body.errors || upload.status);
    process.exit(1);
  }

  console.log(`OK — token can deploy to Pages project "${project}"`);
})();
