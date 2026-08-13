# Running Family Frame on Railway

Railway builds the `Dockerfile` at the repo root and gives the app a public
HTTPS URL. `railway.json` tells it everything else: the healthcheck at
`/api/health`, restart-on-failure, and a single replica (SQLite assumes one
writer — do not scale this up).

## Setup

### 1. Point Railway at the repo

New Project → **Deploy from GitHub repo** → pick this repo. Under the
service's **Settings → Source**, set the branch to `railway` (or merge this
branch into `main` and leave it).

No build settings needed — Railway reads `railway.json` and the `Dockerfile`.

### 2. Attach a volume at /data — or lose everything on each deploy

Railway wipes the container filesystem on every deploy. All state (the SQLite
database, uploaded photos, the JWT secret) lives under `/data`, so:

Right-click the project canvas (or **Ctrl+K**) → **Volume** → attach to this
service → mount path:

```
/data
```

Without this, every photo, user account and event vanishes on the next push.

### 3. Variables

Only one is worth setting:

| Variable | Value |
|---|---|
| `TZ` | e.g. `America/New_York` — backups, digests and "today" run on this clock |

Everything else configures itself:

- **`PORT`** — Railway assigns it; the server reads it. Do not set your own.
- **`JWT_SECRET`** — auto-generated into `/data/jwt-secret` on first boot.
  Only set it explicitly if you want sessions to survive a volume wipe.
- **`COOKIE_SECURE`** — leave unset. The server trusts Railway's
  `X-Forwarded-Proto` header, so cookies come out secure over the public
  HTTPS URL automatically.
- Email ingestion (Gmail/IMAP), Anthropic extraction, and weather are all
  configured later inside **Admin** in the app itself, not via variables.

### 4. Generate the URL and do first-run setup

Service → **Settings → Networking → Generate Domain**, then open the URL.
The app shows the first-run screen; the account you create there is the
admin. That screen closes permanently after the first account exists.

### 5. Point the wall display at it

In **Admin → Display** you'll find the kiosk URL with its display token:

```
https://<your-app>.up.railway.app/display?token=<display token>
```

Put that in the kiosk browser on the Pi / Proxmox LXC. The display token is
read-only access; sign-in accounts are what family members use at the plain
URL.

## Trade-offs vs. running it on the Proxmox box

- **The frame goes blank when your home internet does.** On the LAN, an
  outage still leaves the display working. On Railway, the display is a
  browser pointed at the internet.
- **Photos and the family calendar live on a third party's disk.**
- **It costs money continuously** — an always-on service plus a volume.
- **Volume backups are yours to arrange.** The app's own backup feature
  (Admin → System) writes to `/data/backups`, which is *the same volume* — it
  protects against mistakes, not against losing the volume. Download a backup
  occasionally.

A middle path: keep the server at home and use Tailscale or the Cloudflare
tunnel scripts in this folder for remote access — that's what they're for.
