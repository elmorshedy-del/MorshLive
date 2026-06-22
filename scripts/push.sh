#!/bin/bash
# Push MorshLive to GitHub using GITHUB_TOKEN from env or .env
set -e
cd "$(dirname "$0")/.."

# Load .env if present (gitignored)
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

TOKEN="${GITHUB_TOKEN:-${github_token}}"
if [ -z "$TOKEN" ]; then
  echo "ERROR: No GITHUB_TOKEN found."
  echo "Add to MorshLive/.env:"
  echo "  GITHUB_TOKEN=ghp_xxxx"
  echo "Or add GITHUB_TOKEN to Cursor Cloud Agents → Secrets and start a NEW agent."
  exit 1
fi

git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${TOKEN}@github.com/elmorshedy-del/MorshLive.git"

echo "Pushing to https://github.com/elmorshedy-del/MorshLive ..."
git push -u origin main

# Remove token from remote URL after push
git remote set-url origin https://github.com/elmorshedy-del/MorshLive.git

echo ""
echo "Done! Public links:"
echo "  https://raw.githack.com/elmorshedy-del/MorshLive/main/watch.html?ch=bein-sports-1"
echo "  https://raw.githack.com/elmorshedy-del/MorshLive/main/watch.html?ch=bein-sports-1&player=2"
