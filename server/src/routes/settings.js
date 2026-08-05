import express from 'express';
import os from 'node:os';
import {
  DEFAULT_SETTINGS,
  db,
  getDisplayToken,
  getSettings,
  newId,
  nowIso,
  rotateDisplayToken,
  setSetting,
} from '../db.js';
import { requireAdmin, requireViewer } from '../auth.js';
import { syncFeed, syncAllFeeds } from '../services/ics.js';
import { scanPhotoFolder } from '../services/photoSources.js';
import { GOOGLE_PHOTOS_STATUS } from '../services/googlePhotos.js';

export const router = express.Router();

/** Only the knobs the kiosk needs — no tokens, no folder paths. */
const DISPLAY_KEYS = [
  'slide_seconds',
  'transition',
  'shuffle',
  'show_captions',
  'agenda_days',
  'week_starts_on',
  'clock_24h',
  'timezone',
  'layout',
  'night_start',
  'night_end',
  'night_brightness',
  'weather_enabled',
  'weather_latitude',
  'weather_longitude',
  'weather_label',
  'weather_units',
  'weather_radar_enabled',
  'weather_return_minutes',
  'frame_add_events',
  'frame_border_width',
  'frame_border_color',
  'frame_border_radius',
];

router.get('/display', requireViewer, (_req, res) => {
  const all = getSettings();
  const out = {};
  for (const key of DISPLAY_KEYS) out[key] = all[key];
  res.json({ settings: out });
});

router.get('/', requireAdmin, (_req, res) => {
  res.json({
    settings: getSettings(),
    defaults: DEFAULT_SETTINGS,
    displayToken: getDisplayToken(),
    displayUrls: localDisplayUrls(getDisplayToken()),
    googlePhotos: GOOGLE_PHOTOS_STATUS,
  });
});

router.put('/', requireAdmin, (req, res) => {
  const updates = req.body?.settings || {};
  const applied = {};
  for (const [key, value] of Object.entries(updates)) {
    // Only known keys, and never the display token through this door.
    if (!(key in DEFAULT_SETTINGS)) continue;
    setSetting(key, value);
    applied[key] = String(value);
  }
  res.json({ settings: getSettings(), applied });
});

router.post('/display-token/rotate', requireAdmin, (_req, res) => {
  const token = rotateDisplayToken();
  res.json({ displayToken: token, displayUrls: localDisplayUrls(token) });
});

/** Convenience: the exact URLs to paste into the kiosk browser. */
function localDisplayUrls(token) {
  const port = process.env.PORT || 4000;
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) addresses.push(iface.address);
    }
  }
  if (!addresses.length) addresses.push('localhost');
  return addresses.map((host) => `http://${host}:${port}/display?token=${token}`);
}

router.post('/rescan-folder', requireAdmin, async (_req, res) => {
  const result = await scanPhotoFolder();
  res.json(result);
});

/* ---------------------------------- feeds ---------------------------------- */

export const feedRouter = express.Router();

feedRouter.get('/', requireAdmin, (_req, res) => {
  const feeds = db.prepare('SELECT * FROM feeds ORDER BY created_at').all();
  res.json({
    feeds: feeds.map((f) => ({
      id: f.id,
      name: f.name,
      url: f.url,
      color: f.color,
      enabled: !!f.enabled,
      lastFetchAt: f.last_fetch_at,
      lastError: f.last_error,
      eventCount: f.event_count,
    })),
  });
});

feedRouter.post('/', requireAdmin, async (req, res) => {
  const { name, url, color } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'A name is required' });

  const raw = String(url || '').trim();
  if (!/^(https?|webcal):\/\//i.test(raw)) {
    return res.status(400).json({ error: 'URL must start with https://, http:// or webcal://' });
  }

  const feed = {
    id: newId(),
    name: name.trim(),
    url: raw,
    color: color || '#60a5fa',
    enabled: 1,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO feeds (id, name, url, color, enabled, created_at)
     VALUES (@id, @name, @url, @color, @enabled, @created_at)`
  ).run(feed);

  // Fetch immediately so the admin sees straight away whether the URL works.
  const result = await syncFeed(feed);
  const saved = db.prepare('SELECT * FROM feeds WHERE id = ?').get(feed.id);
  res.status(201).json({ feed: { ...saved, enabled: !!saved.enabled }, sync: result });
});

feedRouter.patch('/:id', requireAdmin, async (req, res) => {
  const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(req.params.id);
  if (!feed) return res.status(404).json({ error: 'Feed not found' });

  const { name, url, color, enabled } = req.body || {};
  db.prepare('UPDATE feeds SET name = ?, url = ?, color = ?, enabled = ? WHERE id = ?').run(
    name?.trim() || feed.name,
    url?.trim() || feed.url,
    color || feed.color,
    enabled === undefined ? feed.enabled : enabled ? 1 : 0,
    feed.id
  );

  const updated = db.prepare('SELECT * FROM feeds WHERE id = ?').get(feed.id);
  if (updated.enabled && updated.url !== feed.url) await syncFeed(updated);
  res.json({ feed: { ...updated, enabled: !!updated.enabled } });
});

feedRouter.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM feeds WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

feedRouter.post('/sync', requireAdmin, async (_req, res) => {
  res.json({ results: await syncAllFeeds() });
});
