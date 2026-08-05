/**
 * The appointment inbox: raw emails/texts come in, structured calendar events
 * come out — either automatically (ingest_auto_add) or after human review.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { db, getSetting, newId, nowIso } from '../db.js';
import { extractAppointment, extractionToEvent } from './extract.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function insertEventFromExtraction(extracted) {
  const fields = extractionToEvent(extracted);
  if (!fields) return null;

  const isAllDay = fields.allDay;
  const start = isAllDay
    ? `${fields.startsAt}T00:00:00.000Z`
    : new Date(fields.startsAt).toISOString();
  const end = fields.endsAt
    ? new Date(fields.endsAt).toISOString()
    : isAllDay
      ? new Date(new Date(start).getTime() + DAY_MS).toISOString()
      : new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();

  const event = {
    id: newId(),
    title: fields.title,
    description: fields.description,
    location: fields.location,
    starts_at: start,
    ends_at: end,
    all_day: isAllDay ? 1 : 0,
    color: fields.color,
    created_by: null, // system-created
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO events (id, title, description, location, starts_at, ends_at, all_day, color, created_by, created_at, updated_at)
     VALUES (@id, @title, @description, @location, @starts_at, @ends_at, @all_day, @color, @created_by, @created_at, @updated_at)`
  ).run(event);
  return event.id;
}

/**
 * Stores a raw message and runs extraction. Returns the inbox row.
 * `externalRef` (e.g. IMAP message-id) makes re-delivery a no-op.
 */
export async function ingestMessage({ source, sender, subject, body, externalRef }) {
  const trimmed = (body || '').trim();
  if (!trimmed) throw new Error('Empty message body');

  if (externalRef) {
    const existing = db.prepare('SELECT * FROM inbox_items WHERE external_ref = ?').get(externalRef);
    if (existing) return { item: existing, duplicate: true };
  }

  const id = newId();
  db.prepare(
    `INSERT INTO inbox_items (id, source, sender, subject, body, received_at, status, external_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(id, source, sender || null, subject || null, trimmed.slice(0, 8000), nowIso(), externalRef || null, nowIso());

  let status = 'failed';
  let extracted = null;
  let eventId = null;
  let error = null;

  try {
    extracted = await extractAppointment(trimmed, { sender, subject });
    if (!extracted.is_appointment) {
      status = 'dismissed';
      error = 'No appointment found in the message';
    } else if (getSetting('ingest_auto_add') === 'true' && extracted.confidence !== 'low') {
      eventId = insertEventFromExtraction(extracted);
      status = eventId ? 'added' : 'needs_review';
    } else {
      status = 'needs_review';
    }
  } catch (err) {
    error = err.message;
  }

  db.prepare(
    'UPDATE inbox_items SET status = ?, extracted = ?, event_id = ?, error = ? WHERE id = ?'
  ).run(status, extracted ? JSON.stringify(extracted) : null, eventId, error, id);

  return { item: db.prepare('SELECT * FROM inbox_items WHERE id = ?').get(id), duplicate: false };
}

/** Admin approves a reviewed item (optionally with edited fields). */
export function approveInboxItem(id, overrides = {}) {
  const item = db.prepare('SELECT * FROM inbox_items WHERE id = ?').get(id);
  if (!item) throw new Error('Inbox item not found');
  if (item.status === 'added') return item;

  const extracted = { ...(item.extracted ? JSON.parse(item.extracted) : {}), ...overrides };
  const eventId = insertEventFromExtraction(extracted);
  if (!eventId) throw new Error('The extracted appointment is missing a valid date');

  db.prepare("UPDATE inbox_items SET status = 'added', event_id = ?, extracted = ? WHERE id = ?").run(
    eventId,
    JSON.stringify(extracted),
    id
  );
  return db.prepare('SELECT * FROM inbox_items WHERE id = ?').get(id);
}

/* --------------------------------- IMAP ---------------------------------- */

let timer = null;
let polling = false;

export async function pollImapOnce() {
  const host = (getSetting('imap_host') || '').trim();
  const user = (getSetting('imap_user') || '').trim();
  const password = getSetting('imap_password') || '';
  if (!host || !user || !password) return { skipped: true };

  if (polling) return { skipped: true, reason: 'already running' };
  polling = true;

  const clientImap = new ImapFlow({
    host,
    port: Number(getSetting('imap_port')) || 993,
    secure: true,
    auth: { user, pass: password },
    logger: false,
  });

  let processed = 0;
  try {
    await clientImap.connect();
    const lock = await clientImap.getMailboxLock(getSetting('imap_folder') || 'INBOX');
    try {
      // Unseen messages only; mark seen after ingesting so nothing is handled twice
      // even if the message-id dedupe misses.
      for await (const message of clientImap.fetch({ seen: false }, { source: true, uid: true })) {
        try {
          const mail = await simpleParser(message.source);
          await ingestMessage({
            source: 'email',
            sender: mail.from?.text || null,
            subject: mail.subject || null,
            body: mail.text || mail.html?.replace(/<[^>]+>/g, ' ') || '',
            externalRef: mail.messageId || `imap-${host}-${message.uid}`,
          });
          await clientImap.messageFlagsAdd({ uid: String(message.uid) }, ['\\Seen'], { uid: true });
          processed += 1;
        } catch (err) {
          console.error('[imap] failed to ingest a message:', err.message);
        }
      }
    } finally {
      lock.release();
    }
    await clientImap.logout();
    return { skipped: false, processed };
  } catch (err) {
    console.error('[imap] poll failed:', err.message);
    try {
      await clientImap.logout();
    } catch {
      /* already disconnected */
    }
    return { skipped: false, error: err.message, processed };
  } finally {
    polling = false;
  }
}

export function startImapPolling() {
  const run = async () => {
    await pollImapOnce().catch((err) => console.error('[imap]', err));
    const minutes = Math.max(1, Number(getSetting('imap_poll_minutes')) || 5);
    timer = setTimeout(run, minutes * 60 * 1000);
    timer.unref?.();
  };
  timer = setTimeout(run, 8000);
  timer.unref?.();
}
