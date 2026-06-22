#!/bin/bash
# Run this in your own terminal (logged into GitHub as elmorshedy-del)
set -e
cd "$(dirname "$0")/.."

if ! git remote get-url origin 2>/dev/null | grep -q "MorshLive"; then
  git remote remove origin 2>/dev/null || true
  git remote add origin https://github.com/elmorshedy-del/MorshLive.git
fi

echo "Pushing to https://github.com/elmorshedy-del/MorshLive ..."
git push -u origin main

echo ""
echo "Done! Your public links:"
echo "  https://raw.githack.com/elmorshedy-del/MorshLive/main/watch.html?ch=bein-sports-1"
echo "  https://raw.githack.com/elmorshedy-del/MorshLive/main/watch.html?ch=bein-sports-1&player=2"
