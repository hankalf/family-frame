import express from 'express';
import { requireAdmin } from '../auth.js';
import { buildHealthReport, sendHealthDigest } from '../services/health.js';
import { buildStorageReport, clearDerivedCache } from '../services/storage.js';

export const router = express.Router();

router.get('/storage', requireAdmin, (req, res) => {
  res.json(buildStorageReport({ force: req.query.refresh === 'true' }));
});

router.post('/storage/clear-cache', requireAdmin, (_req, res) => {
  res.json({ ...clearDerivedCache(), storage: buildStorageReport({ force: true }) });
});

router.get('/health-report', requireAdmin, (_req, res) => {
  res.json(buildHealthReport());
});

router.post('/health-report/send', requireAdmin, async (_req, res) => {
  try {
    const result = await sendHealthDigest();
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
