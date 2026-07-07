#!/usr/bin/env bash
# Pre-kickoff stream verification — external cron (NOT GitHub Actions).
#
# Install on any VPS, home server, or the Cloud Agent pod:
#
#   chmod +x scripts/prekickoff-cron.sh
#   crontab -e
#
# Every 10 minutes — catches matches ~45 min before kickoff:
#   */10 * * * * /absolute/path/to/MorshLive/scripts/prekickoff-cron.sh >> /absolute/path/to/MorshLive/logs/prekickoff/cron.log 2>&1
#
# Optional env (or export in crontab):
#   KZ_BASE=https://korazero.com
#   PREKICKOFF_STRESS=45
#   PREKICKOFF_WINDOW=45
#   PREKICKOFF_SLACK=10
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
SLACK="${PREKICKOFF_SLACK:-10}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] prekickoff cron start base=$KZ_BASE"

# Ensure Chromium is available for Playwright.
if ! node -e "require('playwright-core')" 2>/dev/null; then
  echo "playwright-core missing — run npm install in $ROOT" >&2
  exit 1
fi

node scripts/prekickoff-stream-verify.mjs \
  --base="$KZ_BASE" \
  --window="$WINDOW" \
  --slack="$SLACK" \
  --stress="$STRESS" \
  --out="$ROOT/reports/prekickoff"

code=$?
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] prekickoff cron exit=$code"
exit "$code"
