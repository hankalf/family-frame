import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { requireAdmin } from '../auth.js';
import { backupRoot, listBackups, runBackup } from '../services/backup.js';

export const router = express.Router();

router.get('/', requireAdmin, (_req, res) => {
  res.json(listBackups());
});

router.post('/run', requireAdmin, async (_req, res) => {
  res.json(await runBackup());
});

/**
 * Downloads just the database from a generation — small, and the piece you
 * can't reconstruct from the photo files alone. Whole-library downloads belong
 * to rsync, not a browser.
 */
router.get('/:name/database', requireAdmin, (req, res) => {
  const name = req.params.name;
  // Never let a crafted name walk out of the backup directory.
  if (!/^frame-backup-\d{8}T\d{6}(-\d{1,2})?$/.test(name)) {
    return res.status(400).json({ error: 'Invalid backup name' });
  }

  const file = path.join(backupRoot(), name, 'frame.db');
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(backupRoot()))) {
    return res.status(400).json({ error: 'Invalid backup name' });
  }
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Backup not found' });

  res.download(resolved, `${name}.db`);
});
