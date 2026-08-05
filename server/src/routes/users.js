import express from 'express';
import crypto from 'node:crypto';
import { db, newId, nowIso } from '../db.js';
import { hashPassword, publicUser, requireAdmin, requireAuth } from '../auth.js';

export const router = express.Router();

const bool = (value, fallback = false) =>
  value === undefined ? (fallback ? 1 : 0) : value ? 1 : 0;

router.get('/', requireAdmin, (_req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at').all();
  res.json({ users: users.map(publicUser) });
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { name, isAdmin, canUploadPhotos, canAddEvents, disabled, password } = req.body || {};

  // Guard against an admin locking everyone out of the admin screens.
  const removingAdmin =
    user.is_admin && (isAdmin === false || disabled === true);
  if (removingAdmin) {
    const remaining = db
      .prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled = 0 AND id != ?')
      .get(user.id).n;
    if (remaining === 0) {
      return res.status(409).json({ error: 'There must be at least one active admin' });
    }
  }
  if (user.id === req.user.id && disabled === true) {
    return res.status(409).json({ error: 'You cannot disable your own account' });
  }

  db.prepare(
    `UPDATE users SET
       name = ?, is_admin = ?, can_upload_photos = ?, can_add_events = ?, disabled = ?
     WHERE id = ?`
  ).run(
    name?.trim() || user.name,
    bool(isAdmin, !!user.is_admin),
    bool(canUploadPhotos, !!user.can_upload_photos),
    bool(canAddEvents, !!user.can_add_events),
    bool(disabled, !!user.disabled),
    user.id
  );

  if (password) {
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      await hashPassword(password),
      user.id
    );
  }

  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.id) {
    return res.status(409).json({ error: 'You cannot delete your own account' });
  }
  const remainingAdmins = db
    .prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled = 0 AND id != ?')
    .get(user.id).n;
  if (user.is_admin && remainingAdmins === 0) {
    return res.status(409).json({ error: 'There must be at least one active admin' });
  }

  // Photos and events survive; their author becomes NULL via ON DELETE SET NULL.
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

/* ---------------------------------- invites --------------------------------- */

export const inviteRouter = express.Router();

inviteRouter.get('/', requireAdmin, (_req, res) => {
  const invites = db
    .prepare(
      `SELECT i.*, u.name AS used_by_name
       FROM invites i LEFT JOIN users u ON u.id = i.used_by
       ORDER BY i.created_at DESC`
    )
    .all();
  res.json({
    invites: invites.map((i) => ({
      code: i.code,
      name: i.name,
      isAdmin: !!i.is_admin,
      canUploadPhotos: !!i.can_upload_photos,
      canAddEvents: !!i.can_add_events,
      createdAt: i.created_at,
      expiresAt: i.expires_at,
      usedBy: i.used_by_name,
      usedAt: i.used_at,
    })),
  });
});

inviteRouter.post('/', requireAdmin, (req, res) => {
  const { name, isAdmin, canUploadPhotos, canAddEvents, expiresInDays } = req.body || {};
  const code = crypto.randomBytes(9).toString('base64url');
  const days = Number(expiresInDays);
  const expiresAt =
    Number.isFinite(days) && days > 0
      ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
      : null;

  db.prepare(
    `INSERT INTO invites (code, name, is_admin, can_upload_photos, can_add_events, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    code,
    name?.trim() || null,
    bool(isAdmin, false),
    bool(canUploadPhotos, true),
    bool(canAddEvents, false),
    req.user.id,
    nowIso(),
    expiresAt
  );

  res.status(201).json({ code, expiresAt });
});

inviteRouter.delete('/:code', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM invites WHERE code = ? AND used_by IS NULL').run(req.params.code);
  res.json({ ok: true });
});

/** Lets any signed-in member see exactly what they're allowed to do. */
export const meRouter = express.Router();
meRouter.get('/permissions', requireAuth, (req, res) => {
  res.json({
    canUploadPhotos: !!(req.user.is_admin || req.user.can_upload_photos),
    canAddEvents: !!(req.user.is_admin || req.user.can_add_events),
    isAdmin: !!req.user.is_admin,
  });
});

export { newId, nowIso };
