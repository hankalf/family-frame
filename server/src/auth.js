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

/**
 * Marks the cookie secure per-request rather than from a fixed env var.
 *
 * Once a tunnel or Tailscale is in front, the same server is reached two ways:
 * https from outside and plain http from the LAN. A hard-coded
 * COOKIE_SECURE=true silently breaks every LAN login, because the browser
 * refuses to store a secure cookie over http. Express derives `req.secure`
 * from X-Forwarded-Proto (we set `trust proxy`), so each visitor gets the right
 * one. COOKIE_SECURE=true still forces it on for an HTTPS-only deployment.
 */
function cookieIsSecure(req) {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return !!req.secure;
}

export function issueSession(res, user, req = res.req) {
  const token = jwt.sign({ sub: user.id }, SECRET, { expiresIn: `${MAX_AGE_DAYS}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieIsSecure(req),
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
