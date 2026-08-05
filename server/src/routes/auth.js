import express from 'express';
import { db, newId, nowIso } from '../db.js';
import {
  clearSession,
  hashPassword,
  issueSession,
  publicUser,
  requireAuth,
  verifyPassword,
} from '../auth.js';

export const router = express.Router();

const MIN_PASSWORD = 8;

const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

router.get('/status', (req, res) => {
  res.json({ needsSetup: countUsers() === 0, user: publicUser(req.user) });
});

router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/** First-run only: creates the initial admin. Closes permanently after that. */
router.post('/setup', async (req, res) => {
  if (countUsers() > 0) return res.status(409).json({ error: 'Setup has already been completed' });

  const { name, email, password } = req.body || {};
  const cleanEmail = normalizeEmail(email);
  if (!name?.trim() || !cleanEmail || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
  }

  const user = {
    id: newId(),
    email: cleanEmail,
    name: name.trim(),
    password_hash: await hashPassword(password),
    is_admin: 1,
    can_upload_photos: 1,
    can_add_events: 1,
    disabled: 0,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, is_admin, can_upload_photos, can_add_events, disabled, created_at)
     VALUES (@id, @email, @name, @password_hash, @is_admin, @can_upload_photos, @can_add_events, @disabled, @created_at)`
  ).run(user);

  issueSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));

  // Same response either way so this can't be used to enumerate accounts.
  const ok = user ? await verifyPassword(String(password || ''), user.password_hash) : false;
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password' });
  if (user.disabled) return res.status(403).json({ error: 'This account has been disabled' });

  issueSession(res, user);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

/** Redeems an invite code into a real account. */
router.post('/register', async (req, res) => {
  const { code, name, email, password } = req.body || {};
  const invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(String(code || '').trim());

  if (!invite) return res.status(404).json({ error: 'That invite code is not valid' });
  if (invite.used_by) return res.status(409).json({ error: 'That invite has already been used' });
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ error: 'That invite has expired' });
  }

  const cleanEmail = normalizeEmail(email);
  if (!name?.trim() || !cleanEmail || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(cleanEmail)) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  const user = {
    id: newId(),
    email: cleanEmail,
    name: name.trim(),
    password_hash: await hashPassword(password),
    is_admin: invite.is_admin,
    can_upload_photos: invite.can_upload_photos,
    can_add_events: invite.can_add_events,
    disabled: 0,
    created_at: nowIso(),
  };

  db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, is_admin, can_upload_photos, can_add_events, disabled, created_at)
       VALUES (@id, @email, @name, @password_hash, @is_admin, @can_upload_photos, @can_add_events, @disabled, @created_at)`
    ).run(user);
    db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').run(
      user.id,
      nowIso(),
      invite.code
    );
  })();

  issueSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

/** Public preview so the signup screen can say what the invite grants. */
router.get('/invite/:code', (req, res) => {
  const invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(req.params.code);
  if (!invite || invite.used_by) return res.status(404).json({ error: 'Invite not found' });
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ error: 'That invite has expired' });
  }
  res.json({
    invite: {
      name: invite.name,
      isAdmin: !!invite.is_admin,
      canUploadPhotos: !!invite.can_upload_photos,
      canAddEvents: !!invite.can_add_events,
    },
  });
});

router.post('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!(await verifyPassword(String(currentPassword || ''), req.user.password_hash))) {
    return res.status(403).json({ error: 'Current password is incorrect' });
  }
  if (!newPassword || newPassword.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    await hashPassword(newPassword),
    req.user.id
  );
  res.json({ ok: true });
});
