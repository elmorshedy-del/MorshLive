#!/usr/bin/env bash
# Deploy static site to Cloudflare Pages (korazero).
# Reads token from the first available env var (Cursor secrets may use any of these names).
set -euo pipefail
cd "$(dirname "$0")/.."

TOKEN="${CLOUDFLARE_API_TOKEN:-${CLOUDFLARE_TOKEN5:-${Cloudflare:-}}}"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-${CLOUDFLAREID:-}}"

if [[ -z "$TOKEN" ]]; then
  echo "No Cloudflare token found. Set one of: CLOUDFLARE_API_TOKEN, CLOUDFLARE_TOKEN5, Cloudflare"
  exit 1
fi
if [[ -z "$ACCOUNT_ID" ]]; then
  echo "Missing CLOUDFLARE_ACCOUNT_ID"
  exit 1
fi

# Strip accidental spaces (broken global keys were pasted with a space mid-string).
TOKEN="${TOKEN// /}"

echo "Verifying token can deploy..."
CLOUDFLARE_API_TOKEN="$TOKEN" CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID" node scripts/verify-deploy-token.js

echo "Deploying to Cloudflare Pages (korazero)..."
CLOUDFLARE_API_TOKEN="$TOKEN" CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID" \
  npx wrangler pages deploy . --project-name=korazero --branch=main
