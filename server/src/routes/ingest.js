import express from 'express';
import crypto from 'node:crypto';
import { db, getIngestSecret } from '../db.js';
import { requireAdmin, requirePermission } from '../auth.js';
import { approveInboxItem, ingestMessage, pollImapOnce } from '../services/inbox.js';
import { llmAvailable } from '../services/extract.js';

export const router = express.Router();

function shape(item) {
  return {
    id: item.id,
    source: item.source,
    sender: item.sender,
    subject: item.subject,
    body: item.body,
    receivedAt: item.received_at,
    status: item.status,
    extracted: item.extracted ? JSON.parse(item.extracted) : null,
    eventId: item.event_id,
    error: item.error,
  };
}

/**
 * Webhook for SMS-forwarder apps (e.g. Android "SMS to URL Forwarder").
 * Secured by a secret in the path so simple forwarders that can't set headers
 * still work: POST /api/ingest/hook/<secret>
 * Accepts JSON {from, text|body|message} or form-encoded equivalents.
 */
router.post('/hook/:secret', express.urlencoded({ extended: true }), async (req, res) => {
  const expected = getIngestSecret();
  const supplied = req.params.secret || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Bad secret' });
  }

  const payload = req.body || {};
  const text = payload.text ?? payload.body ?? payload.message ?? payload.content;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing message text (expected "text", "body" or "message")' });
  }

  try {
    const { item, duplicate } = await ingestMessage({
      source: 'sms',
      sender: payload.from ?? payload.sender ?? null,
      subject: null,
      body: text,
    });
    res.status(duplicate ? 200 : 201).json({ status: item.status, duplicate });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Paste-a-confirmation: any member who can add events. */
router.post('/paste', requirePermission('can_add_events'), async (req, res) => {
  const { text } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'Paste the confirmation text first' });

  try {
    const { item } = await ingestMessage({
      source: 'paste',
      sender: req.user.name,
      subject: null,
      body: text,
    });
    res.status(201).json({ item: shape(item) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ------------------------------ admin review ------------------------------ */

router.get('/inbox', requireAdmin, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM inbox_items ORDER BY created_at DESC LIMIT 200')
    .all();
  res.json({
    items: rows.map(shape),
    reviewCount: db.prepare("SELECT COUNT(*) AS n FROM inbox_items WHERE status = 'needs_review'").get().n,
    llmAvailable: llmAvailable(),
    ingestSecret: getIngestSecret(),
  });
});

router.post('/inbox/:id/approve', requireAdmin, (req, res) => {
  try {
    const item = approveInboxItem(req.params.id, req.body?.overrides || {});
    res.json({ item: shape(item) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/inbox/:id/dismiss', requireAdmin, (req, res) => {
  db.prepare("UPDATE inbox_items SET status = 'dismissed' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.delete('/inbox/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM inbox_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/poll-email', requireAdmin, async (_req, res) => {
  res.json(await pollImapOnce());
});
