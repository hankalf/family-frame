# Family Frame — calendar dashboard + digital picture frame

A wall display (Raspberry Pi / mini-PC stick) that shows a photo slideshow next to the
family calendar, plus a phone-friendly companion app where family members sign in to add
photos and events — each with their own permissions.

```
┌─────────────────────────────┐        ┌──────────────────┐
│  Kiosk display  /display    │        │  Family app /app │
│  photos · clock · agenda    │◄──────►│  upload photos   │
│  (TV / Pi, no login,        │ server │  add events      │
│   paired by token)          │        │  admin: users,   │
└─────────────────────────────┘        │  feeds, settings │
                                       └──────────────────┘
```

## Features

- **Photo frame** — crossfade or Ken Burns slideshow, blurred fill for portrait shots,
  captions and "Added by" credit, shuffle, per-photo dedupe by content hash, HEIC accepted,
  everything resized server-side so the frame never downloads 12 MB originals.
- **Calendar** — subscribe to any number of iCal feeds (iCloud public/private links,
  Outlook published calendars, `webcal://`), with recurring-event expansion, plus local
  "family events" added from the app. Merged agenda, color-coded per source.
- **Family accounts & permissions** — invite links with per-person permissions:
  *can add photos*, *can add calendar events*, *admin*. Admins can also require approval
  for new photos before they appear on the wall.
- **Display niceties** — night dimming on a schedule, screen wake-lock, offline-tolerant
  (keeps showing cached data and says so), photos-only / calendar-only / combined layouts.
- **Touchscreen support** — a minimal menu at the bottom-center of the display switches
  between Calendar / Both / Photos / Weather with a tap. It idles semi-transparent, wakes on
  touch, and the frame remembers the chosen view. The admin's layout setting is the default;
  changing it remotely takes back over until the screen is next touched.
- **Screen border** — an optional bezel drawn around the display (width, colour, corner
  radius) with a live preview in Admin → Display. Useful when the physical frame doesn't
  quite cover the panel edges, or just for a mat-board look.
- **Month calendar on the frame** — the Calendar tab is a full month grid with each day's
  events, month back/forward and a "Today" jump. Tap any day to see what's on and add an
  event right there — including a built-in on-screen keyboard, since a wall frame has no
  physical one. Turn it off with **Adding events from the frame** in Admin → Display.
- **Weather** — a compact current-conditions widget in the sidebar plus a full Weather tab:
  now, next 12 hours, 7-day forecast, and an animated rain radar. Uses
  [Open-Meteo](https://open-meteo.com) (free, no API key, no account) with server-side caching,
  so the frame keeps showing the last good reading when the network drops. Radar tiles come
  from RainViewer over a CARTO/OpenStreetMap base map and are the only part that needs the
  *display itself* to reach the internet — it degrades to "Radar unavailable" and leaves the
  forecast intact.
- **Photo folder import** — optionally point it at a folder (USB stick, Syncthing,
  network share) and it imports new images automatically.
- **Family feed** — an Instagram-style feed in the app: everyone's photos in one
  scrolling stream with likes (double-tap or ♥).
- **Appointment ingestion** — forward doctors'-office emails to a dedicated mailbox
  (IMAP), forward texts via an SMS-forwarder app webhook, or paste confirmation text
  into the app. The server extracts the appointment (Claude API if `ANTHROPIC_API_KEY`
  is set on the server, otherwise a built-in date parser) and either adds it to the
  calendar or holds it in Admin → Appointments for review.

> **Google Photos?** Google removed general read access to Photos libraries for
> third-party apps in 2025, so album sync can't be built reliably. See
> `server/src/services/googlePhotos.js` for details and the adapter contract if you want
> to wire up Immich or similar instead. The folder import + app uploads cover the same need.

## Tech

- **Server** — Node 20+, Express, better-sqlite3 (single-file DB), sharp (image resizing),
  node-ical (feed parsing), JWT session cookies. All state lives in `server/data/` —
  back up that one folder.
- **Web** — React + Vite + Tailwind. One build serves both the kiosk (`/display`) and the
  companion app (`/app`, installable as a PWA).

## Run it (development)

```bash
npm install
npm run dev
```

- App: http://localhost:5173/app — first visit creates the admin account.
- Kiosk: sign in → Admin → Display → copy the kiosk URL into another tab.
- API runs on http://localhost:4000.

## Run it (production / on the frame)

```bash
npm install
npm run build
npm start          # serves app + API + kiosk on port 4000
```

Then from your phone: `http://<server-ip>:4000/app` → create the admin account →
Admin → Display → copy the kiosk URL → open it once in the browser on the frame.
The screen pairs itself and remembers (token survives reboots via localStorage).

Set `PORT` to change the port, `DATA_DIR` to move the data folder.

## Proxmox deployment (recommended for home servers)

Run the server in a small LXC container; the frame then just opens a URL.

**Option A — plain Debian LXC (lightest):**

1. On the Proxmox host, create a Debian 12 container (1 GB RAM / 2 cores / 8 GB disk is
   plenty; unprivileged is fine — see the header of
   [deploy/proxmox-lxc-setup.sh](deploy/proxmox-lxc-setup.sh) for a ready `pct create` line).
2. Inside the container:

   ```bash
   FRAME_REPO_URL=https://github.com/hankalf/family-frame.git bash <(curl -fsSL https://raw.githubusercontent.com/hankalf/family-frame/main/deploy/proxmox-lxc-setup.sh)
   ```

   The script installs Node 22 + avahi, clones, builds, creates a systemd service on
   port 80, and prints the URLs when done.

**Option B — Docker** (in a VM or a Docker-enabled LXC):

```bash
docker compose up -d --build
```

**The URL.** The container broadcasts itself over mDNS, so on most home networks the app
is at **`http://frame.local/app`** and the display at
**`http://frame.local/display?token=…`** (name = the container's hostname). If a device
on your network doesn't resolve `.local` names, either add a DNS entry for the
container's IP in your router (or Pi-hole), or give the LXC a static IP and use that.
Data lives in `/var/lib/frame` (LXC) or the `frame-data` volume (Docker) — snapshot the
container or back up that path.

## Raspberry Pi kiosk setup

Works well on a Pi 4/5 (Pi 3 is OK for the display; run the server elsewhere or be
patient with HEIC uploads). Two roles, which can be the same machine:

**1. The server** (Pi, mini-PC, NAS — anything with Node 20+):

```bash
sudo apt install -y nodejs npm    # or install Node 20+ via nodesource
git clone <this repo> frame && cd frame
npm install && npm run build
```

Create `/etc/systemd/system/frame.service`:

```ini
[Unit]
Description=Family Frame server
After=network-online.target

[Service]
WorkingDirectory=/home/pi/frame
ExecStart=/usr/bin/node server/src/index.js
Restart=always
Environment=PORT=4000
User=pi

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now frame
```

**2. The display** (the Pi driving the TV) — Chromium kiosk autostart. On Raspberry Pi OS
with the Wayland/labwc desktop, add to `~/.config/labwc/autostart`:

```
chromium-browser --kiosk --noerrdialogs --disable-infobars --incognito=false \
  --app=http://<server-ip>:4000/display?token=<your-token> &
```

(On older X11 setups, put the same command in `~/.config/lxsession/LXDE-pi/autostart`
prefixed with `@`.) Don't use `--incognito`: the display token is remembered in
localStorage, and incognito would forget it every boot — though the `?token=` in the URL
re-pairs it anyway.

Disable screen blanking: `sudo raspi-config` → Display Options → Screen Blanking → No.

**Mini-PC stick (Windows)**: create a shortcut in `shell:startup`:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --app=http://<server-ip>:4000/display?token=<your-token>
```

## Getting calendar URLs

- **iCloud**: Calendar app → right-click calendar → Sharing → Public Calendar → copy the
  `webcal://` link.
- **Outlook / Microsoft 365**: Settings → Calendar → Shared calendars → Publish a
  calendar → copy the ICS link.
- **Google Calendar**: Settings → your calendar → Integrate → *Secret address in iCal
  format* (works fine — it's the Photos API that's restricted, not Calendar).

Paste into **Admin → Calendar feeds**. Feeds refresh every 15 minutes (configurable).

## Security notes

- Designed for a home LAN. If you expose it to the internet, put it behind HTTPS
  (Caddy/Traefik/Tailscale) and set `COOKIE_SECURE=true`.
- The display token grants **read-only** access (photos, agenda, display settings). Rotate
  it from Admin → Display if a URL leaks.
- Passwords are bcrypt-hashed; sessions are httpOnly JWT cookies; invites expire and are
  single-use.
