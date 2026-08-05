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
 * Webhook for forwarding appointment texts in.
 *
 * The secret lives in the path rather than a header because the clients that
 * use this — an iPhone Shortcut, an Android forwarder app — are easiest to set
 * up with nothing but a URL.
 *
 * Deliberately forgiving about the body: Shortcuts can send JSON, form fields
 * or a bare string depending on how the user wires it up, and a family member
 * following setup instructions on a phone shouldn't have to debug that.
 */
router.post(
  '/hook/:secret',
  express.urlencoded({ extended: true }),
  express.text({ type: ['text/*'] }),
  async (req, res) => {
    const expected = getIngestSecret();
    const supplied = req.params.secret || '';
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Bad secret' });
    }

    // A bare string body is the whole message; an object carries it in one of
    // several plausible field names.
    const payload = req.body ?? {};
    const text =
      typeof payload === 'string'
        ? payload
        : (payload.text ?? payload.body ?? payload.message ?? payload.content);

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        error: 'No message text found. Send it as JSON {"text": "..."}, a form field named text, or a plain-text body.',
      });
    }

    try {
      const { item, duplicate } = await ingestMessage({
        source: 'sms',
        sender:
          typeof payload === 'string' ? null : (payload.from ?? payload.sender ?? null),
        subject: null,
        body: text,
      });
      // Shortcuts shows this back to the user, so make it readable.
      res.status(duplicate ? 200 : 201).json({
        status: item.status,
        duplicate,
        message: duplicate
          ? 'Already received that one.'
          : item.status === 'added'
            ? `Added: ${JSON.parse(item.extracted || '{}').title || 'appointment'}`
            : item.status === 'needs_review'
              ? 'Sent to the frame for review.'
              : 'No appointment found in that message.',
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

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
