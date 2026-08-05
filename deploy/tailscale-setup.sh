#!/usr/bin/env bash
# Puts the frame on your tailnet with real HTTPS, so family can reach it from
# anywhere without port forwarding and without exposing anything to the
# internet. Run this inside the LXC.
#
#   bash deploy/tailscale-setup.sh
#
# Afterwards the app is at https://<hostname>.<your-tailnet>.ts.net/app for
# anyone signed into your tailnet. The LAN address keeps working too.
set -euo pipefail

PORT="${FRAME_PORT:-4000}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (or with sudo)." >&2
  exit 1
fi

echo "==> Installing Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

# In an unprivileged LXC there is often no /dev/net/tun, so tailscaled needs
# userspace networking. Harmless when TUN is available.
if [ ! -c /dev/net/tun ]; then
  echo "==> No /dev/net/tun — enabling userspace networking"
  mkdir -p /etc/systemd/system/tailscaled.service.d
  cat > /etc/systemd/system/tailscaled.service.d/override.conf <<'EOF'
[Service]
Environment=TS_DEBUG_FIREWALL_MODE=auto
ExecStart=
ExecStart=/usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --tun=userspace-networking
EOF
  systemctl daemon-reload
  systemctl restart tailscaled
fi

echo
echo "==> Connecting to your tailnet"
echo "    A login link will be printed. Open it and approve this machine."
tailscale up

DNS_NAME="$(tailscale status --json | sed -n 's/.*"DNSName":"\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//')"
if [ -z "$DNS_NAME" ]; then
  echo "Could not read this machine's tailnet name. Is 'tailscale up' complete?" >&2
  exit 1
fi

echo
echo "==> Serving the frame over HTTPS inside the tailnet"
echo "    If this fails, enable HTTPS certificates for your tailnet at:"
echo "    https://login.tailscale.com/admin/dns  (toggle 'HTTPS Certificates')"
tailscale serve --bg --https=443 "http://127.0.0.1:${PORT}"

cat <<EOF

======================================================================
 On your tailnet now:

   Family app:  https://${DNS_NAME}/app
   Kiosk:       https://${DNS_NAME}/display?token=<token>

 The LAN address still works, and sessions work over both — the session
 cookie is marked secure per-request, so http on the LAN is unaffected.

 Add family devices at https://login.tailscale.com/admin/machines
 (or send them an invite link; they install the Tailscale app and sign in).

 To stop serving:  tailscale serve --https=443 off
======================================================================
EOF
