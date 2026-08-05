import express from 'express';
import { db, newId, nowIso } from '../db.js';
import { requireAuth, requirePermission, requireViewer } from '../auth.js';

export const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * All-day events are anchored to midnight UTC of their calendar date, so the
 * date never drifts across timezones. Timed events are real instants.
 */
function normalizeInstant(value, allDay) {
  if (!value) return null;
  if (allDay) {
    const datePart = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
    return `${datePart}T00:00:00.000Z`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function shapeLocal(row) {
  return {
    id: row.id,
    source: 'local',
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: !!row.all_day,
    color: row.color,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    canEdit: false,
  };
}

function shapeFeed(row) {
  return {
    id: row.id,
    source: 'feed',
    feedId: row.feed_id,
    feedName: row.feed_name,
    title: row.title,
    description: null,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: !!row.all_day,
    color: row.feed_color,
    canEdit: false,
  };
}

/**
 * The merged calendar the frame renders: local events plus every enabled feed,
 * sorted chronologically.
 */
router.get('/agenda', requireViewer, (req, res) => {
  const days = Math.min(400, Math.max(1, Number(req.query.days) || 10));
  const from = req.query.from ? new Date(req.query.from) : new Date();
  if (Number.isNaN(from.getTime())) return res.status(400).json({ error: 'Invalid "from" date' });

  // Start at midnight local so "today" includes events already under way.
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + days * DAY_MS);

  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const local = db
    .prepare(
      `SELECT e.*, u.name AS created_by_name
       FROM events e LEFT JOIN users u ON u.id = e.created_by
       WHERE e.ends_at >= ? AND e.starts_at < ?`
    )
    .all(startIso, endIso);

  const feed = db
    .prepare(
      `SELECT fe.*, f.name AS feed_name, f.color AS feed_color
       FROM feed_events fe JOIN feeds f ON f.id = fe.feed_id
       WHERE f.enabled = 1 AND fe.ends_at >= ? AND fe.starts_at < ?`
    )
    .all(startIso, endIso);

  const events = [...local.map(shapeLocal), ...feed.map(shapeFeed)].sort((a, b) => {
    if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
    // All-day events read better above the timed ones for the same day.
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  res.json({ from: startIso, to: endIso, events });
});

/** Local events only — what the companion app lists and manages. */
router.get('/', requireAuth, (req, res) => {
  const days = Math.min(400, Math.max(1, Number(req.query.days) || 60));
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + days * DAY_MS);

  const rows = db
    .prepare(
      `SELECT e.*, u.name AS created_by_name
       FROM events e LEFT JOIN users u ON u.id = e.created_by
       WHERE e.ends_at >= ? AND e.starts_at < ?
       ORDER BY e.starts_at`
    )
    .all(start.toISOString(), end.toISOString());

  const canEditAll = !!req.user.is_admin;
  res.json({
    events: rows.map((row) => ({
      ...shapeLocal(row),
      canEdit: canEditAll || row.created_by === req.user.id,
    })),
  });
});

router.post('/', requirePermission('can_add_events'), (req, res) => {
  const { title, description, location, startsAt, endsAt, allDay, color } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'A title is required' });

  const isAllDay = !!allDay;
  const start = normalizeInstant(startsAt, isAllDay);
  if (!start) return res.status(400).json({ error: 'A valid start date is required' });

  let end = normalizeInstant(endsAt, isAllDay);
  if (!end) {
    // Default: all-day spans that one day, timed runs an hour.
    end = isAllDay
      ? new Date(new Date(start).getTime() + DAY_MS).toISOString()
      : new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
  } else if (isAllDay) {
    // An all-day event ending on its own date should still cover that date.
    if (end <= start) end = new Date(new Date(start).getTime() + DAY_MS).toISOString();
    else end = new Date(new Date(end).getTime() + DAY_MS).toISOString();
  }
  if (end <= start) return res.status(400).json({ error: 'The end must be after the start' });

  const event = {
    id: newId(),
    title: title.trim(),
    description: description?.trim() || null,
    location: location?.trim() || null,
    starts_at: start,
    ends_at: end,
    all_day: isAllDay ? 1 : 0,
    color: color || null,
    created_by: req.user.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  db.prepare(
    `INSERT INTO events (id, title, description, location, starts_at, ends_at, all_day, color, created_by, created_at, updated_at)
     VALUES (@id, @title, @description, @location, @starts_at, @ends_at, @all_day, @color, @created_by, @created_at, @updated_at)`
  ).run(event);

  res.status(201).json({ event: { ...shapeLocal(event), canEdit: true } });
});

function loadEditable(req, res) {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Event not found' });
    return null;
  }
  if (!req.user.is_admin && row.created_by !== req.user.id) {
    res.status(403).json({ error: 'You can only change events you created' });
    return null;
  }
  return row;
}

router.patch('/:id', requirePermission('can_add_events'), (req, res) => {
  const row = loadEditable(req, res);
  if (!row) return;

  const { title, description, location, startsAt, endsAt, allDay, color } = req.body || {};
  const isAllDay = allDay === undefined ? !!row.all_day : !!allDay;
  const start = startsAt ? normalizeInstant(startsAt, isAllDay) : row.starts_at;
  let end = endsAt ? normalizeInstant(endsAt, isAllDay) : row.ends_at;

  if (!start) return res.status(400).json({ error: 'A valid start date is required' });
  if (isAllDay && endsAt) {
    end = new Date(new Date(end).getTime() + DAY_MS).toISOString();
  }
  if (!end || end <= start) return res.status(400).json({ error: 'The end must be after the start' });

  db.prepare(
    `UPDATE events SET title = ?, description = ?, location = ?, starts_at = ?, ends_at = ?,
                       all_day = ?, color = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    title?.trim() || row.title,
    description === undefined ? row.description : description?.trim() || null,
    location === undefined ? row.location : location?.trim() || null,
    start,
    end,
    isAllDay ? 1 : 0,
    color === undefined ? row.color : color || null,
    nowIso(),
    row.id
  );

  const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(row.id);
  res.json({ event: { ...shapeLocal(updated), canEdit: true } });
});

router.delete('/:id', requirePermission('can_add_events'), (req, res) => {
  const row = loadEditable(req, res);
  if (!row) return;
  db.prepare('DELETE FROM events WHERE id = ?').run(row.id);
  res.json({ ok: true });
});
