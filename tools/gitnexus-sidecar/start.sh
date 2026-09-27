#!/usr/bin/env bash
set -euo pipefail

: "${GITNEXUS_MCP_AUTH_TOKEN:?GITNEXUS_MCP_AUTH_TOKEN is required}"

export GITNEXUS_HOME="${GITNEXUS_HOME:-/data/gitnexus}"
export HOME="${GITNEXUS_RUNTIME_HOME:-/data/home}"
REPO_ROOT="${KORAZERO_REPO_ROOT:-/data/repos}"
PORT="${PORT:-3000}"
SYNC_SECONDS="${GITNEXUS_SYNC_SECONDS:-300}"

MORSH_DIR="$REPO_ROOT/MorshLive"
V2_DIR="$REPO_ROOT/KoraZero-StreamV2"

mkdir -p "$GITNEXUS_HOME" "$REPO_ROOT" "$HOME"

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

repair_fts_once() {
  local dir="$1"
  local key="$2"
  local marker="$GITNEXUS_HOME/.fts-repaired-v2-$key"

  if [ -f "$marker" ]; then
    return 0
  fi

  echo "[kz-gitnexus] repairing FTS for $key"
  if gitnexus analyze "$dir" --repair-fts --skip-agents-md --skip-skills; then
    touch "$marker"
    echo "[kz-gitnexus] FTS ready for $key"
  else
    echo "[kz-gitnexus] FTS repair failed for $key; graph tools remain available" >&2
  fi
}

sync_once() {
  echo "[kz-gitnexus] syncing MorshLive/main"
  sync_repo "https://github.com/elmorshedy-del/MorshLive.git" "main" "$MORSH_DIR"
  repair_fts_once "$MORSH_DIR" "MorshLive"

  echo "[kz-gitnexus] syncing KoraZero-StreamV2/feature/gateway-control"
  if ! sync_repo "https://github.com/elmorshedy-del/KoraZero-StreamV2.git" "feature/gateway-control" "$V2_DIR"; then
    echo "[kz-gitnexus] active V2 branch unavailable; falling back to main"
    sync_repo "https://github.com/elmorshedy-del/KoraZero-StreamV2.git" "main" "$V2_DIR"
  fi
  repair_fts_once "$V2_DIR" "KoraZero-StreamV2"

  gitnexus group create korazero >/tmp/gitnexus-group-create.log 2>&1 || true
  gitnexus group add korazero website MorshLive >/tmp/gitnexus-group-add-website.log 2>&1 || true
  gitnexus group add korazero streaming KoraZero-StreamV2 >/tmp/gitnexus-group-add-streaming.log 2>&1 || true
  gitnexus group sync korazero || true

  if [ ! -f "$GITNEXUS_HOME/.kz-bootstrap-verified-v2" ]; then
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

    echo "[kz-gitnexus] === context: shouldIncludeAudienceMatch ==="
    (
      cd "$MORSH_DIR"
      gitnexus context shouldIncludeAudienceMatch --file scripts/matches-lib.js || true
    )

    echo "[kz-gitnexus] === impact: shouldIncludeAudienceMatch upstream ==="
    (
      cd "$MORSH_DIR"
      gitnexus impact shouldIncludeAudienceMatch --file scripts/matches-lib.js --direction upstream || true
    )

    echo "[kz-gitnexus] === group query: controller / active channel / Mist ==="
    gitnexus group query korazero "V2 controller active channel stream plan Mist" || true

    touch "$GITNEXUS_HOME/.kz-bootstrap-verified-v2"
    echo "[kz-gitnexus] === bootstrap verification complete ==="
  fi

  if [ ! -f "$GITNEXUS_HOME/.kz-dual-account-graph-probe-v2" ]; then
    echo "[kz-gitnexus] === dual-account graph probe: active channel/controller ==="
    (
      cd "$V2_DIR"
      gitnexus query "active channel activeChannelId controller channel selection ChannelFrom CreateApp" || true
    )

    echo "[kz-gitnexus] === dual-account graph probe: account/session/upstream ==="
    (
      cd "$V2_DIR"
      gitnexus query "account login auth credentials session upstream relay Mist provider" || true
    )

    echo "[kz-gitnexus] === dual-account graph probe: singletons/locks ==="
    (
      cd "$V2_DIR"
      gitnexus query "single socket singleton mutex lock one active channel one upstream login one pull" || true
    )

    echo "[kz-gitnexus] === dual-account graph probe: CreateApp context ==="
    (
      cd "$V2_DIR"
      gitnexus context CreateApp || true
    )

    echo "[kz-gitnexus] === dual-account graph probe: ChannelFrom context ==="
    (
      cd "$V2_DIR"
      gitnexus context ChannelFrom || true
    )

    echo "[kz-gitnexus] === dual-account graph probe: CreateApp impact ==="
    (
      cd "$V2_DIR"
      gitnexus impact CreateApp --direction upstream || true
    )

    echo "[kz-gitnexus] === dual-account graph probe: ChannelFrom impact ==="
    (
      cd "$V2_DIR"
      gitnexus impact ChannelFrom --direction upstream || true
    )

    touch "$GITNEXUS_HOME/.kz-dual-account-graph-probe-v2"
    echo "[kz-gitnexus] === dual-account graph probe complete ==="
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
