#!/usr/bin/env bash
# Family Frame — bootstrap for a fresh Debian 12/13 LXC on Proxmox.
#
# On the Proxmox host, create the container (unprivileged is fine):
#   pct create 210 local:vztmpl/debian-12-standard_*.tar.zst \
#     --hostname frame --memory 1024 --cores 2 --rootfs local-lvm:8 \
#     --net0 name=eth0,bridge=vmbr0,ip=dhcp --unprivileged 1 --features nesting=1
#   pct start 210 && pct enter 210
#
# Then inside the container:
#   bash <(curl -fsSL https://raw.githubusercontent.com/hankalf/family-frame/main/deploy/proxmox-lxc-setup.sh)
# or copy this repo to /opt/frame yourself and run: bash /opt/frame/deploy/proxmox-lxc-setup.sh
set -euo pipefail

REPO_URL="${FRAME_REPO_URL:-}"   # set FRAME_REPO_URL to git-clone automatically
APP_DIR=/opt/frame
PORT="${FRAME_PORT:-80}"

echo "==> Installing packages (Node 22, git, avahi for frame.local)"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates avahi-daemon libnss-mdns >/dev/null
if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node --version

echo "==> Getting the app into ${APP_DIR}"
if [ -f "${APP_DIR}/server/src/index.js" ]; then
  echo "    found existing copy"
elif [ -n "$REPO_URL" ]; then
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
else
  echo "!! No app found at ${APP_DIR} and FRAME_REPO_URL not set."
  echo "   Either: FRAME_REPO_URL=https://github.com/hankalf/family-frame.git bash $0"
  echo "   Or copy the project to ${APP_DIR} first (from Proxmox host: pct push, or scp)."
  exit 1
fi

cd "$APP_DIR"
echo "==> Installing dependencies and building"
npm install --no-audit --no-fund
npm run build

echo "==> Creating systemd service (port ${PORT})"
cat > /etc/systemd/system/frame.service <<EOF
[Unit]
Description=Family Frame server
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node server/src/index.js
Restart=always
RestartSec=3
Environment=PORT=${PORT}
Environment=DATA_DIR=/var/lib/frame
# Run unprivileged but still allowed to bind port 80
DynamicUser=no
User=root
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
mkdir -p /var/lib/frame
systemctl daemon-reload
systemctl enable --now frame

# avahi broadcasts the container hostname as <hostname>.local
systemctl enable --now avahi-daemon

sleep 2
IP=$(hostname -I | awk '{print $1}')
HOST=$(hostname)
echo
echo "======================================================================"
echo " Family Frame is up."
echo "   Family app:  http://${HOST}.local/app   (or http://${IP}:${PORT}/app)"
echo "   First visit creates the admin account."
echo "   Kiosk URL:   sign in -> Admin -> Display -> copy the display URL"
echo
echo " Update later:  cd ${APP_DIR} && git checkout -- package-lock.json && git pull && npm ci && npm run build && systemctl restart frame"
echo " Backup:        /var/lib/frame  (database + all photos)"
echo "======================================================================"
