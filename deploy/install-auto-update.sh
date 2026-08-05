#!/usr/bin/env bash
# Installs a systemd timer that checks for updates on a schedule.
#
#   bash deploy/install-auto-update.sh            # every 30 minutes
#   FRAME_UPDATE_INTERVAL=6h bash deploy/install-auto-update.sh
#
# Remove with:  systemctl disable --now frame-update.timer
set -euo pipefail

APP_DIR="${FRAME_DIR:-/opt/frame}"
INTERVAL="${FRAME_UPDATE_INTERVAL:-30min}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (or with sudo)." >&2
  exit 1
fi

cat > /etc/systemd/system/frame-update.service <<EOF
[Unit]
Description=Update Family Frame from git
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/env bash ${APP_DIR}/deploy/auto-update.sh
Environment=FRAME_DIR=${APP_DIR}
EOF

cat > /etc/systemd/system/frame-update.timer <<EOF
[Unit]
Description=Check for Family Frame updates

[Timer]
# Wait a little after boot so the network is really up.
OnBootSec=5min
OnUnitActiveSec=${INTERVAL}
# Spread the check so several frames don't all pull at once.
RandomizedDelaySec=120
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now frame-update.timer

cat <<EOF

======================================================================
 Auto-update is on — checking every ${INTERVAL}.

   Status:     systemctl status frame-update.timer
   Next run:   systemctl list-timers frame-update.timer
   Update now: systemctl start frame-update.service
   Logs:       journalctl -u frame-update.service -n 50

 It only rebuilds when the commit actually changed, verifies /api/health
 afterwards, and rolls back to the previous commit if the app doesn't come
 back up.

 Turn it off:  systemctl disable --now frame-update.timer
======================================================================
EOF
