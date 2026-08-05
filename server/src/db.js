import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { DB_PATH, ensureDirs } from './paths.js';

ensureDirs();

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  is_admin           INTEGER NOT NULL DEFAULT 0,
  can_upload_photos  INTEGER NOT NULL DEFAULT 1,
  can_add_events     INTEGER NOT NULL DEFAULT 0,
  disabled           INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code               TEXT PRIMARY KEY,
  name               TEXT,
  is_admin           INTEGER NOT NULL DEFAULT 0,
  can_upload_photos  INTEGER NOT NULL DEFAULT 1,
  can_add_events     INTEGER NOT NULL DEFAULT 0,
  created_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL,
  expires_at         TEXT,
  used_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
  used_at            TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  location     TEXT,
  starts_at    TEXT NOT NULL,
  ends_at      TEXT NOT NULL,
  all_day      INTEGER NOT NULL DEFAULT 0,
  color        TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(starts_at);

CREATE TABLE IF NOT EXISTS feeds (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  url            TEXT NOT NULL,
  color          TEXT,
  enabled        INTEGER NOT NULL DEFAULT 1,
  last_fetch_at  TEXT,
  last_error     TEXT,
  event_count    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

-- Expanded occurrences from .ics feeds. Replaced wholesale on each poll so the
-- frame keeps showing the last good copy if the network drops.
CREATE TABLE IF NOT EXISTS feed_events (
  id         TEXT PRIMARY KEY,
  feed_id    TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  uid        TEXT,
  title      TEXT NOT NULL,
  location   TEXT,
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  all_day    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_feed_events_start ON feed_events(starts_at);

CREATE TABLE IF NOT EXISTS photos (
  id            TEXT PRIMARY KEY,
  filename      TEXT NOT NULL,
  original_name TEXT,
  caption       TEXT,
  width         INTEGER,
  height        INTEGER,
  bytes         INTEGER,
  hash          TEXT,
  taken_at      TEXT,
  source        TEXT NOT NULL DEFAULT 'upload',
  source_ref    TEXT,
  status        TEXT NOT NULL DEFAULT 'approved',
  uploaded_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_hash ON photos(hash) WHERE hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Incoming appointment texts/emails awaiting extraction or review.
CREATE TABLE IF NOT EXISTS inbox_items (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL,             -- 'email' | 'sms' | 'paste'
  sender       TEXT,
  subject      TEXT,
  body         TEXT NOT NULL,
  received_at  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | needs_review | added | dismissed | failed
  extracted    TEXT,                      -- JSON of the parsed appointment
  event_id     TEXT REFERENCES events(id) ON DELETE SET NULL,
  error        TEXT,
  external_ref TEXT,                      -- e.g. IMAP message-id, for dedupe
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox_items(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_ref ON inbox_items(external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS photo_likes (
  photo_id   TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (photo_id, user_id)
);
`);

export const DEFAULT_SETTINGS = {
  // Photo frame
  slide_seconds: '25',
  transition: 'kenburns', // 'fade' | 'kenburns'
  shuffle: 'true',
  show_captions: 'true',
  // Calendar
  agenda_days: '10',
  week_starts_on: '1', // 0 = Sunday, 1 = Monday
  clock_24h: 'true',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  feed_poll_minutes: '15',
  // Display
  layout: 'sidebar', // 'sidebar' | 'photo-only' | 'calendar-only'
  night_start: '22:00',
  night_end: '06:30',
  night_brightness: '0.12',
  // Moderation
  require_photo_approval: 'false',
  // Local folder photo source ('' disables it)
  photo_folder_path: '',
  folder_scan_minutes: '30',
  // Appointment ingestion
  ingest_auto_add: 'false', // 'true' adds straight to calendar; 'false' holds for review
  ingest_default_color: '#f472b6',
  imap_host: '',
  imap_port: '993',
  imap_user: '',
  imap_password: '',
  imap_folder: 'INBOX',
  imap_poll_minutes: '5',
};

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return row.value;
  return DEFAULT_SETTINGS[key] ?? null;
}

export function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    out[row.key] = row.value;
  }
  return out;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

/** Token the kiosk uses instead of a login. Generated on first read. */
export function getDisplayToken() {
  let row = db.prepare('SELECT value FROM settings WHERE key = ?').get('display_token');
  if (!row) {
    const token = crypto.randomBytes(24).toString('base64url');
    setSetting('display_token', token);
    return token;
  }
  return row.value;
}

export function rotateDisplayToken() {
  const token = crypto.randomBytes(24).toString('base64url');
  setSetting('display_token', token);
  return token;
}

/** Secret for the SMS/webhook ingest endpoint. Generated on first read. */
export function getIngestSecret() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ingest_secret');
  if (row) return row.value;
  const secret = crypto.randomBytes(24).toString('base64url');
  setSetting('ingest_secret', secret);
  return secret;
}

export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
