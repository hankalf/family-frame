import express from 'express';
import { requireAdmin } from '../auth.js';
import { buildHealthReport, sendHealthDigest } from '../services/health.js';

export const router = express.Router();

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
