#!/usr/bin/env bash
# Pulls, builds and restarts — but only when something actually changed.
#
# Pull-based on purpose: nothing inbound is opened, no deploy key or SSH
# credential leaves the box, and it keeps working if the frame moves network.
# Install it on a timer with deploy/install-auto-update.sh.
#
# Run by hand any time:  bash /opt/frame/deploy/auto-update.sh
set -euo pipefail

APP_DIR="${FRAME_DIR:-/opt/frame}"
BRANCH="${FRAME_BRANCH:-main}"
SERVICE="${FRAME_SERVICE:-frame}"

cd "$APP_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# The build writes into web/dist and npm may touch the lockfile; neither should
# ever block a pull.
git checkout -- package-lock.json 2>/dev/null || true

log "Fetching origin/$BRANCH"
git fetch --quiet origin "$BRANCH"

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  log "Already up to date ($(git rev-parse --short HEAD))"
  exit 0
fi

log "Updating $(git rev-parse --short "$LOCAL") -> $(git rev-parse --short "$REMOTE")"
git log --oneline "$LOCAL..$REMOTE" | sed 's/^/    /'

# Keep the current build so a failure can be rolled back rather than leaving
# the wall showing a half-updated app.
ROLLBACK="$LOCAL"

if ! git merge --ff-only "origin/$BRANCH"; then
  log "ERROR: cannot fast-forward — the working tree has diverged. Fix by hand."
  exit 1
fi

deploy_failed() {
  log "ERROR: update failed; rolling back to ${ROLLBACK:0:7}"
  git reset --hard "$ROLLBACK" >/dev/null
  npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm ci --no-audit --no-fund >/dev/null 2>&1 || true
  npm run build >/dev/null 2>&1 || true
  systemctl restart "$SERVICE" || true
  exit 1
}
trap deploy_failed ERR

log "Installing dependencies"
npm ci --no-audit --no-fund

log "Building"
npm run build

log "Restarting $SERVICE"
systemctl restart "$SERVICE"

trap - ERR

# Give it a moment, then confirm it actually came back up.
sleep 4
PORT="${FRAME_PORT:-4000}"
if curl -fsS --max-time 10 "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
  log "Updated to $(git rev-parse --short HEAD) and healthy"
else
  log "ERROR: service did not answer /api/health after the update"
  deploy_failed
fi
