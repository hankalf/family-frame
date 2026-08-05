import express from 'express';
import { db, nowIso } from '../db.js';
import { requireAdmin, requireViewer } from '../auth.js';

export const router = express.Router();

/** How stale a heartbeat can be before a display counts as offline. */
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;

/**
 * Kiosks call this every minute. Authenticated by the display token (or a
 * session), same as the rest of the read surface. The device id is generated
 * on the kiosk and must look like one of ours.
 */
router.post('/heartbeat', requireViewer, (req, res) => {
  const { deviceId, width, height, layout } = req.body || {};
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) {
    return res.status(400).json({ error: 'Invalid device id' });
  }

  const now = nowIso();
  const userAgent = (req.get('user-agent') || '').slice(0, 300);
  db.prepare(
    `INSERT INTO displays (id, user_agent, width, height, layout, first_seen, last_seen)
     VALUES (@id, @user_agent, @width, @height, @layout, @now, @now)
     ON CONFLICT(id) DO UPDATE SET
       user_agent = excluded.user_agent,
       width = excluded.width,
       height = excluded.height,
       layout = excluded.layout,
       last_seen = excluded.last_seen`
  ).run({
    id: deviceId,
    user_agent: userAgent,
    width: Number.isFinite(+width) ? Math.trunc(+width) : null,
    height: Number.isFinite(+height) ? Math.trunc(+height) : null,
    layout: typeof layout === 'string' ? layout.slice(0, 30) : null,
    now,
  });

  res.json({ ok: true });
});

router.get('/', requireAdmin, (_req, res) => {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  const rows = db.prepare('SELECT * FROM displays ORDER BY last_seen DESC').all();
  res.json({
    displays: rows.map((row) => ({
      id: row.id,
      name: row.name,
      userAgent: row.user_agent,
      width: row.width,
      height: row.height,
      layout: row.layout,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      online: new Date(row.last_seen).getTime() >= cutoff,
    })),
  });
});

router.patch('/:id', requireAdmin, (req, res) => {
  const display = db.prepare('SELECT id FROM displays WHERE id = ?').get(req.params.id);
  if (!display) return res.status(404).json({ error: 'Display not found' });
  db.prepare('UPDATE displays SET name = ? WHERE id = ?').run(
    req.body?.name?.trim() || null,
    display.id
  );
  res.json({ ok: true });
});

/** Forget a display. If it's still running it will simply re-register. */
router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM displays WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
