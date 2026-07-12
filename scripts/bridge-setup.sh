#!/bin/bash
# ============================================================================
# MorshLive Bridge — VPS Provisioning Script
# Run as root on a fresh Ubuntu 22.04/24.04 VPS (4 vCPU, 8 GB RAM min)
# ============================================================================
set -euo pipefail

echo "=== MorshLive Bridge VPS Setup ==="

# --- 1. System updates & required packages ---
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw

# --- 2. Configure firewall: only 80, 443, 22 public ---
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment SSH
ufw allow 80/tcp comment HTTP-for-TLS
ufw allow 443/tcp comment HTTPS
ufw --force enable

# --- 3. Install Docker ---
if ! command -v docker &> /dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# --- 4. Clone and deploy ---
mkdir -p /opt/morshlive
cd /opt/morshlive

if [ -d "MorshLive" ]; then
  cd MorshLive && git pull
else
  git clone https://github.com/elmorshedy-del/MorshLive.git
  cd MorshLive
fi

cd bridge

# Pull latest and start
docker compose pull
docker compose up -d
docker compose ps

echo ""
echo "=== Bridge deployed ==="
echo "Health check: curl -i http://localhost/health"
echo "Bridge UI (SSH tunnel): ssh -L 8080:127.0.0.1:80 user@$(hostname -I | awk '{print $1}')"
echo ""
echo "Next: Set up HTTPS using Caddy:"
echo "  apt-get install -y caddy"
echo "  echo 'bridge.korazero.com { reverse_proxy localhost:80 }' > /etc/caddy/Caddyfile"
echo "  systemctl restart caddy"
