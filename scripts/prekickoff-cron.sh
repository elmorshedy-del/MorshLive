#!/usr/bin/env bash
# Pre-kickoff stream verification — external cron (NOT GitHub Actions).
#
# Install on any VPS, home server, or the Cloud Agent pod:
#
#   chmod +x scripts/prekickoff-cron.sh
#   crontab -e
#
# Every 10 minutes — catches matches ~45 min before kickoff (T-45±15m window):
#   */10 * * * * /absolute/path/to/MorshLive/scripts/prekickoff-cron.sh >> /absolute/path/to/MorshLive/logs/prekickoff/cron.log 2>&1
#
# Optional env (or export in crontab):
#   KZ_BASE=https://korazero.com
#   PREKICKOFF_STRESS=45
#   PREKICKOFF_WINDOW=45
#   PREKICKOFF_SLACK=15
#   PREKICKOFF_DEPLOY=1   — wrangler deploy when heal updates assets/data/stream-routes.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

mkdir -p logs/prekickoff reports/prekickoff

export KZ_BASE="${KZ_BASE:-https://korazero.com}"
STRESS="${PREKICKOFF_STRESS:-45}"
WINDOW="${PREKICKOFF_WINDOW:-45}"
SLACK="${PREKICKOFF_SLACK:-15}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] prekickoff cron start base=$KZ_BASE"

# Refresh today.json from ESPN before selecting T-45 window.
node scripts/fetch-matches.js "$(date -u +%Y-%m-%d)" || echo "fetch-matches failed — continuing with cached today.json" >&2

# Ensure Chromium is available for Playwright.
if ! node -e "require('playwright-core')" 2>/dev/null; then
  echo "playwright-core missing — run npm install in $ROOT" >&2
  exit 1
fi

ROUTES_HASH_BEFORE=""
if [[ -f assets/data/stream-routes.json ]]; then
  ROUTES_HASH_BEFORE=$(md5sum assets/data/stream-routes.json | awk '{print $1}')
fi

node scripts/prekickoff-stream-verify.mjs \
  --base="$KZ_BASE" \
  --window="$WINDOW" \
  --slack="$SLACK" \
  --stress="$STRESS" \
  --out="$ROOT/reports/prekickoff"

code=$?

if [[ "${PREKICKOFF_DEPLOY:-}" == "1" ]] && [[ -f .env ]] && [[ -f assets/data/stream-routes.json ]]; then
  ROUTES_HASH_AFTER=$(md5sum assets/data/stream-routes.json | awk '{print $1}')
  if [[ "$ROUTES_HASH_BEFORE" != "$ROUTES_HASH_AFTER" ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] heal updated stream-routes — deploying"
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
    npx wrangler deploy || code=$?
  fi
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] prekickoff cron exit=$code"
exit "$code"
