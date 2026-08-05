#!/usr/bin/env bash
# Publishes the frame on a domain you own — https://frame.example.com — via a
# Cloudflare Tunnel. The tunnel dials *out*, so nothing inbound is exposed and
# no ports are forwarded.
#
#   DOMAIN=frame.example.com bash deploy/cloudflare-tunnel-setup.sh
#
# Requires: a domain whose nameservers point at Cloudflare (the free plan is
# enough). Two steps are interactive and will print a link to open.
#
# ⚠️  A Cloudflare Tunnel puts the frame on the public internet. Anyone with the
#     URL reaches the login page. That's a real change in exposure compared with
#     Tailscale, which stays private to your devices — see the Access note at
#     the end, and prefer Tailscale unless you specifically need a public URL.
set -euo pipefail

PORT="${FRAME_PORT:-4000}"
DOMAIN="${DOMAIN:-}"
TUNNEL_NAME="${TUNNEL_NAME:-family-frame}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (or with sudo)." >&2
  exit 1
fi
if [ -z "$DOMAIN" ]; then
  echo "Set DOMAIN first, e.g.  DOMAIN=frame.example.com bash $0" >&2
  exit 1
fi

echo "==> Installing cloudflared"
if ! command -v cloudflared >/dev/null; then
  ARCH="$(dpkg --print-architecture)"
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
  dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
fi

if [ ! -f /root/.cloudflared/cert.pem ]; then
  echo
  echo "==> Authorising with Cloudflare"
  echo "    A link will be printed — open it and pick the zone for ${DOMAIN}."
  cloudflared tunnel login
fi

if ! cloudflared tunnel list | awk '{print $2}' | grep -qx "$TUNNEL_NAME"; then
  echo "==> Creating tunnel '${TUNNEL_NAME}'"
  cloudflared tunnel create "$TUNNEL_NAME"
fi

TUNNEL_ID="$(cloudflared tunnel list | awk -v n="$TUNNEL_NAME" '$2==n {print $1}' | head -1)"
if [ -z "$TUNNEL_ID" ]; then
  echo "Could not determine the tunnel id." >&2
  exit 1
fi

echo "==> Writing /etc/cloudflared/config.yml"
mkdir -p /etc/cloudflared
cp "/root/.cloudflared/${TUNNEL_ID}.json" "/etc/cloudflared/${TUNNEL_ID}.json"
cat > /etc/cloudflared/config.yml <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: /etc/cloudflared/${TUNNEL_ID}.json

ingress:
  - hostname: ${DOMAIN}
    service: http://127.0.0.1:${PORT}
  - service: http_status:404
EOF

echo "==> Pointing ${DOMAIN} at the tunnel"
cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN"

echo "==> Installing the service"
cloudflared --config /etc/cloudflared/config.yml service install || true
systemctl enable --now cloudflared
systemctl restart cloudflared

cat <<EOF

======================================================================
 Live at:

   Family app:  https://${DOMAIN}/app
   Kiosk:       https://${DOMAIN}/display?token=<token>

 Cloudflare terminates TLS and forwards the original scheme, so session
 cookies are marked secure automatically. The LAN address keeps working.

 ⚠️  This URL is public. Before sharing it, consider putting Cloudflare
     Access in front (free for up to 50 users) so only email-verified
     family members reach the login page at all:
     https://one.dash.cloudflare.com  ->  Access  ->  Applications

 Logs:  journalctl -u cloudflared -f
======================================================================
EOF
