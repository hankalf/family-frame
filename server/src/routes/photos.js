import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { db, getSetting, newId, nowIso } from '../db.js';
import { ORIGINALS_DIR } from '../paths.js';
import { requireAdmin, requireAuth, requirePermission, requireViewer } from '../auth.js';
import {
  ACCEPTED,
  deleteDerivatives,
  getDerivative,
  hashFile,
  pregenerate,
  readMetadata,
} from '../services/images.js';

export const router = express.Router();

const MAX_FILE_BYTES = 40 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ORIGINALS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${newId()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: 20 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ACCEPTED.has(ext)) return cb(new Error(`Unsupported file type: ${ext || 'unknown'}`));
    cb(null, true);
  },
});

function shape(row) {
  return {
    id: row.id,
    caption: row.caption,
    originalName: row.original_name,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    takenAt: row.taken_at,
    source: row.source,
    status: row.status,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name ?? null,
    createdAt: row.created_at,
  };
}

/* --------------------------------- display -------------------------------- */

/**
 * The frame's playlist: approved photos only. IDs plus just enough metadata to
 * lay a slide out, so the kiosk can hold the whole list in memory and prefetch.
 */
router.get('/playlist', requireViewer, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.caption, p.width, p.height, p.taken_at, p.created_at, u.name AS uploaded_by_name
       FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE p.status = 'approved'
       ORDER BY p.created_at DESC`
    )
    .all();

  res.json({
    photos: rows.map((row) => ({
      id: row.id,
      caption: row.caption,
      width: row.width,
      height: row.height,
      takenAt: row.taken_at,
      addedAt: row.created_at,
      addedBy: row.uploaded_by_name,
    })),
  });
});

/** Serves a resized JPEG. `size` is `thumb` or `display`. */
router.get('/:id/file', requireViewer, async (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  if (photo.status !== 'approved' && !req.user) {
    return res.status(403).json({ error: 'Photo is not approved' });
  }

  try {
    const file = await getDerivative(photo, req.query.size === 'thumb' ? 'thumb' : 'display');
    if (!file) return res.status(404).json({ error: 'Image file is missing' });
    // Derivatives are content-addressed by photo id and never mutate.
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('image/jpeg');
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error(`[photos] failed to render ${photo.id}:`, err.message);
    res.status(500).json({ error: 'Could not render that image' });
  }
});

/* ------------------------------- companion app ------------------------------ */

router.get('/', requireAuth, (req, res) => {
  const status = ['approved', 'pending', 'rejected'].includes(req.query.status)
    ? req.query.status
    : null;
  const mine = req.query.mine === 'true';

  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('p.status = ?');
    params.push(status);
  }
  if (mine) {
    clauses.push('p.uploaded_by = ?');
    params.push(req.user.id);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT p.*, u.name AS uploaded_by_name
       FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
       ${where}
       ORDER BY p.created_at DESC
       LIMIT 500`
    )
    .all(...params);

  res.json({
    photos: rows.map(shape),
    pendingCount: db.prepare("SELECT COUNT(*) AS n FROM photos WHERE status = 'pending'").get().n,
  });
});

router.post('/', requirePermission('can_upload_photos'), (req, res) => {
  upload.array('photos', 20)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files were uploaded' });

    const needsApproval =
      getSetting('require_photo_approval') === 'true' && !req.user.is_admin;
    const captions = [].concat(req.body?.captions || []);

    const added = [];
    const duplicates = [];

    for (const [index, file] of files.entries()) {
      const fullPath = path.join(ORIGINALS_DIR, file.filename);
      let hash = null;
      try {
        hash = hashFile(fullPath);
      } catch {
        /* hashing is best-effort; a null hash just skips dedupe */
      }

      if (hash) {
        const existing = db.prepare('SELECT id FROM photos WHERE hash = ?').get(hash);
        if (existing) {
          fs.rmSync(fullPath, { force: true });
          duplicates.push(file.originalname);
          continue;
        }
      }

      const meta = await readMetadata(fullPath);
      const id = path.basename(file.filename, path.extname(file.filename));
      const row = {
        id,
        filename: file.filename,
        original_name: file.originalname,
        caption: (captions[index] || '').toString().trim() || null,
        width: meta.width,
        height: meta.height,
        bytes: file.size,
        hash,
        taken_at: meta.takenAt ?? nowIso(),
        source: 'upload',
        source_ref: null,
        status: needsApproval ? 'pending' : 'approved',
        uploaded_by: req.user.id,
        created_at: nowIso(),
      };

      db.prepare(
        `INSERT INTO photos (id, filename, original_name, caption, width, height, bytes, hash,
                             taken_at, source, source_ref, status, uploaded_by, created_at)
         VALUES (@id, @filename, @original_name, @caption, @width, @height, @bytes, @hash,
                 @taken_at, @source, @source_ref, @status, @uploaded_by, @created_at)`
      ).run(row);

      pregenerate(row);
      added.push(shape(row));
    }

    res.status(201).json({
      photos: added,
      duplicates,
      pendingApproval: needsApproval,
    });
  });
});

router.patch('/:id', requireAuth, (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });

  const { caption, status } = req.body || {};
  const isOwner = photo.uploaded_by === req.user.id;
  if (!req.user.is_admin && !isOwner) {
    return res.status(403).json({ error: 'You can only change photos you added' });
  }
  // Moderation is an admin decision, even on your own upload.
  if (status !== undefined && !req.user.is_admin) {
    return res.status(403).json({ error: 'Only admins can approve or reject photos' });
  }
  if (status !== undefined && !['approved', 'pending', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  db.prepare('UPDATE photos SET caption = ?, status = ? WHERE id = ?').run(
    caption === undefined ? photo.caption : caption?.trim() || null,
    status === undefined ? photo.status : status,
    photo.id
  );

  res.json({ photo: shape(db.prepare('SELECT * FROM photos WHERE id = ?').get(photo.id)) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  if (!req.user.is_admin && photo.uploaded_by !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete photos you added' });
  }

  db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
  deleteDerivatives(photo.id);
  fs.rmSync(path.join(ORIGINALS_DIR, photo.filename), { force: true });
  res.json({ ok: true });
});

/** Bulk moderation so a backlog of pending uploads isn't a click marathon. */
router.post('/moderate', requireAdmin, (req, res) => {
  const { ids, status } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No photos given' });
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved or rejected' });
  }
  const update = db.prepare('UPDATE photos SET status = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id) => update.run(status, id)))();
  res.json({ ok: true, updated: ids.length });
});
