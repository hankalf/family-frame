import fs from 'node:fs';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, getDisplayToken } from './db.js';
import { SECRET_PATH, ensureDirs } from './paths.js';

const COOKIE = 'frame_session';
const MAX_AGE_DAYS = 60;

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  ensureDirs();
  if (!fs.existsSync(SECRET_PATH)) {
    fs.writeFileSync(SECRET_PATH, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(SECRET_PATH, 'utf8').trim();
}

const SECRET = loadSecret();

export const hashPassword = (plain) => bcrypt.hash(plain, 11);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id }, SECRET, { expiresIn: `${MAX_AGE_DAYS}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // The frame lives on a LAN over plain http; flip this on behind a TLS proxy.
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: !!user.is_admin,
    canUploadPhotos: !!user.can_upload_photos,
    canAddEvents: !!user.can_add_events,
    disabled: !!user.disabled,
    createdAt: user.created_at,
  };
}

/**
 * Populates req.user (from the session cookie) and req.isDisplay (from the
 * kiosk token). Never rejects — the guards below do that.
 */
export function attachIdentity(req, _res, next) {
  req.user = null;
  req.isDisplay = false;

  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
      if (user && !user.disabled) req.user = user;
    } catch {
      /* expired or tampered — treated as anonymous */
    }
  }

  const supplied =
    req.get('x-display-token') ||
    (typeof req.query.display_token === 'string' ? req.query.display_token : null);
  if (supplied) {
    const expected = getDisplayToken();
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) req.isDisplay = true;
  }

  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only' });
  next();
}

/** Guards a permission flag, with admins implicitly allowed. */
export function requirePermission(flag) {
  const label = flag === 'can_add_events' ? 'add calendar events' : 'upload photos';
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (req.user.is_admin || req.user[flag]) return next();
    return res.status(403).json({ error: `You do not have permission to ${label}` });
  };
}

/** Read-only endpoints the kiosk needs: a session OR a valid display token. */
export function requireViewer(req, res, next) {
  if (req.user || req.isDisplay) return next();
  return res.status(401).json({ error: 'Not signed in' });
}
