#!/usr/bin/env bash
# Deploy korazero to Cloudflare Pages.
# Resolves token from CLOUDFLARE_TOKEN5, CLOUDFLARE_API_TOKEN, Cloudflare, or any cfat_ env value.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! RESOLVE=$(node scripts/resolve-cloudflare-token.js --export 2>/dev/null); then
  echo "Could not find a deploy-capable Cloudflare token in this environment."
  echo ""
  echo "Add your cfat_ token to Cursor Cloud Agent secrets as CLOUDFLARE_API_TOKEN"
  echo "(or CLOUDFLARE_TOKEN5 — this script checks both once injected)."
  echo ""
  node scripts/resolve-cloudflare-token.js || true
  exit 1
fi

# shellcheck disable=SC1090
eval "$RESOLVE"

echo "Token resolved. Verifying..."
node scripts/verify-deploy-token.js

echo "Deploying to Cloudflare Pages (korazero)..."
npx wrangler pages deploy . --project-name=korazero --branch=main
