#!/usr/bin/env bash
set -euo pipefail

: "${GITNEXUS_MCP_AUTH_TOKEN:?GITNEXUS_MCP_AUTH_TOKEN is required}"

export GITNEXUS_HOME="${GITNEXUS_HOME:-/data/gitnexus}"
REPO_ROOT="${KORAZERO_REPO_ROOT:-/data/repos}"
PORT="${PORT:-3000}"
SYNC_SECONDS="${GITNEXUS_SYNC_SECONDS:-300}"

MORSH_DIR="$REPO_ROOT/MorshLive"
V2_DIR="$REPO_ROOT/KoraZero-StreamV2"

mkdir -p "$GITNEXUS_HOME" "$REPO_ROOT"

sync_repo() {
  local url="$1"
  local branch="$2"
  local dir="$3"

  if [ ! -d "$dir/.git" ]; then
    rm -rf "$dir"
    git clone --depth 1 --branch "$branch" "$url" "$dir"
  else
    git -C "$dir" fetch --depth 1 origin "$branch"
    git -C "$dir" checkout -q "$branch"
    git -C "$dir" reset --hard "origin/$branch"
    git -C "$dir" clean -fd -e .gitnexus/
  fi

  gitnexus analyze "$dir" --skip-agents-md --skip-skills
}

sync_once() {
  echo "[kz-gitnexus] syncing MorshLive/main"
  sync_repo "https://github.com/elmorshedy-del/MorshLive.git" "main" "$MORSH_DIR"

  echo "[kz-gitnexus] syncing KoraZero-StreamV2/feature/gateway-control"
  if ! sync_repo "https://github.com/elmorshedy-del/KoraZero-StreamV2.git" "feature/gateway-control" "$V2_DIR"; then
    echo "[kz-gitnexus] active V2 branch unavailable; falling back to main"
    sync_repo "https://github.com/elmorshedy-del/KoraZero-StreamV2.git" "main" "$V2_DIR"
  fi

  gitnexus group create korazero >/tmp/gitnexus-group-create.log 2>&1 || true
  gitnexus group add korazero website MorshLive >/tmp/gitnexus-group-add-website.log 2>&1 || true
  gitnexus group add korazero streaming KoraZero-StreamV2 >/tmp/gitnexus-group-add-streaming.log 2>&1 || true
  gitnexus group sync korazero || true

  if [ ! -f "$GITNEXUS_HOME/.kz-bootstrap-verified" ]; then
    echo "[kz-gitnexus] === bootstrap verification ==="
    gitnexus list || true
    gitnexus group list korazero || true

    echo "[kz-gitnexus] === query: stream-plan / V2 / watch ==="
    (
      cd "$MORSH_DIR"
      gitnexus query "stream plan V2 controller active state watch player" || true
    )

    echo "[kz-gitnexus] === query: national-team audience filter ==="
    (
      cd "$MORSH_DIR"
      gitnexus query "European national team audience filter shouldIncludeAudienceMatch" || true
    )

    echo "[kz-gitnexus] === group query: controller / active channel / Mist ==="
    gitnexus group query korazero "V2 controller active channel stream plan Mist" || true

    touch "$GITNEXUS_HOME/.kz-bootstrap-verified"
    echo "[kz-gitnexus] === bootstrap verification complete ==="
  fi

  echo "[kz-gitnexus] sync complete"
}

sync_loop() {
  while true; do
    if ! sync_once; then
      echo "[kz-gitnexus] sync failed; keeping previous published indexes" >&2
    fi
    sleep "$SYNC_SECONDS"
  done
}

sync_loop &
SYNC_PID=$!

gitnexus mcp --http --host 0.0.0.0 --port "$PORT" --auth-token "$GITNEXUS_MCP_AUTH_TOKEN" &
MCP_PID=$!

cleanup() {
  kill "$SYNC_PID" "$MCP_PID" 2>/dev/null || true
  wait "$SYNC_PID" "$MCP_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# MCP is the serving process. If it dies, fail the container so Railway restarts it.
wait "$MCP_PID"
