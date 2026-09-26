#!/usr/bin/env bash
set -euo pipefail

: "${GITNEXUS_MCP_AUTH_TOKEN:?GITNEXUS_MCP_AUTH_TOKEN is required}"

export GITNEXUS_HOME="${GITNEXUS_HOME:-/data/gitnexus}"
REPO_ROOT="${KORAZERO_REPO_ROOT:-/repos}"
PORT="${PORT:-3000}"

mkdir -p "$GITNEXUS_HOME" "$REPO_ROOT"

cat > "$GITNEXUS_HOME/watch_config.yml" <<EOF
sync_interval_minutes: 5
max_concurrency: 1
repo_git_timeout: 60s
analyze_timeout: 20m
analyze_failure_threshold: 3
projects:
  - local_path: $REPO_ROOT
    branches: [main]
    overwrite_local_changes: false
    group_name: korazero
    remote_urls:
      - https://github.com/elmorshedy-del/MorshLive.git
  - local_path: $REPO_ROOT
    branches: [feature/gateway-control, main]
    overwrite_local_changes: false
    group_name: korazero
    remote_urls:
      - https://github.com/elmorshedy-del/KoraZero-StreamV2.git
EOF

# Group creation is idempotent for our purposes.
gitnexus group create korazero >/tmp/gitnexus-group-create.log 2>&1 || true

gitnexus auto-sync start &
SYNC_PID=$!

gitnexus mcp --http --host 0.0.0.0 --port "$PORT" --auth-token "$GITNEXUS_MCP_AUTH_TOKEN" &
MCP_PID=$!

cleanup() {
  kill "$SYNC_PID" "$MCP_PID" 2>/dev/null || true
  wait "$SYNC_PID" "$MCP_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# If either process dies, fail the container so Railway restarts it.
wait -n "$SYNC_PID" "$MCP_PID"
