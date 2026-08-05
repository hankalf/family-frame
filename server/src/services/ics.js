import ical from 'node-ical';
import { db, getSetting, newId, nowIso } from '../db.js';

/** How far around "now" we expand recurring events. */
const PAST_DAYS = 3;
const FUTURE_DAYS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * node-ical keys EXDATE / RECURRENCE-ID overrides by a date string whose exact
 * shape varies with the source calendar, so probe the plausible forms.
 */
function occurrenceKeys(date) {
  const iso = date.toISOString();
  return [
    iso.slice(0, 10), // 2026-08-05
    iso, // full ISO
    date.toDateString(), // Wed Aug 05 2026
  ];
}

function lookupOccurrence(map, date) {
  if (!map) return undefined;
  for (const key of occurrenceKeys(date)) {
    if (map[key]) return map[key];
  }
  return undefined;
}

/**
 * rrule works in floating/UTC terms, so an occurrence generated on the other
 * side of a DST boundary lands an hour off. Re-apply the difference between the
 * series start's offset and this occurrence's offset.
 */
function correctForDst(seriesStart, occurrence) {
  const baseOffset = seriesStart.getTimezoneOffset();
  const occOffset = occurrence.getTimezoneOffset();
  if (baseOffset === occOffset) return occurrence;
  return new Date(occurrence.getTime() + (occOffset - baseOffset) * 60 * 1000);
}

function isAllDay(event) {
  return event.datetype === 'date' || (!!event.start && event.start.dateOnly === true);
}

/** Expands one VEVENT into concrete occurrences inside [rangeStart, rangeEnd]. */
function expandEvent(event, rangeStart, rangeEnd) {
  const out = [];
  if (event.type !== 'VEVENT' || !event.start) return out;

  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : new Date(start.getTime() + 60 * 60 * 1000);
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const allDay = isAllDay(event);

  const push = (occStart, occEnd, override) => {
    if (occEnd < rangeStart || occStart > rangeEnd) return;
    out.push({
      uid: event.uid || null,
      title: (override?.summary ?? event.summary ?? 'Untitled').toString().trim(),
      location: (override?.location ?? event.location ?? null) || null,
      starts_at: occStart.toISOString(),
      ends_at: occEnd.toISOString(),
      all_day: allDay ? 1 : 0,
    });
  };

  if (!event.rrule) {
    push(start, end);
    return out;
  }

  // Widen the window by the duration so an event that started before the window
  // but is still running gets picked up.
  const searchFrom = new Date(rangeStart.getTime() - durationMs);
  let dates = [];
  try {
    dates = event.rrule.between(searchFrom, rangeEnd, true);
  } catch {
    // A malformed RRULE shouldn't sink the whole feed — fall back to the single
    // instance the VEVENT itself describes.
    push(start, end);
    return out;
  }

  for (const raw of dates) {
    const occStart = allDay ? new Date(raw) : correctForDst(start, new Date(raw));

    if (lookupOccurrence(event.exdate, raw)) continue;

    const override = lookupOccurrence(event.recurrences, raw);
    if (override) {
      const oStart = new Date(override.start);
      const oEnd = override.end
        ? new Date(override.end)
        : new Date(oStart.getTime() + durationMs);
      push(oStart, oEnd, override);
      continue;
    }

    push(occStart, new Date(occStart.getTime() + durationMs));
  }

  // A cancelled-but-still-listed override can sit outside the RRULE results.
  for (const key of Object.keys(event.recurrences || {})) {
    const override = event.recurrences[key];
    if (!override?.start) continue;
    const oStart = new Date(override.start);
    if (dates.some((d) => Math.abs(d.getTime() - oStart.getTime()) < 1000)) continue;
    const oEnd = override.end ? new Date(override.end) : new Date(oStart.getTime() + durationMs);
    push(oStart, oEnd, override);
  }

  return out;
}

async function fetchIcs(url) {
  // webcal:// is just http(s) with a different scheme sticker on it.
  const normalized = url.replace(/^webcal:\/\//i, 'https://');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(normalized, {
      signal: controller.signal,
      headers: { 'User-Agent': 'frame-dashboard/1.0' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const replaceFeedEvents = db.transaction((feedId, rows) => {
  db.prepare('DELETE FROM feed_events WHERE feed_id = ?').run(feedId);
  const insert = db.prepare(`
    INSERT INTO feed_events (id, feed_id, uid, title, location, starts_at, ends_at, all_day)
    VALUES (@id, @feed_id, @uid, @title, @location, @starts_at, @ends_at, @all_day)
  `);
  for (const row of rows) insert.run({ ...row, id: newId(), feed_id: feedId });
});

export async function syncFeed(feed) {
  const rangeStart = new Date(Date.now() - PAST_DAYS * DAY_MS);
  const rangeEnd = new Date(Date.now() + FUTURE_DAYS * DAY_MS);

  try {
    const text = await fetchIcs(feed.url);
    const parsed = ical.parseICS(text);

    const rows = [];
    for (const key of Object.keys(parsed)) {
      rows.push(...expandEvent(parsed[key], rangeStart, rangeEnd));
    }

    replaceFeedEvents(feed.id, rows);
    db.prepare(
      'UPDATE feeds SET last_fetch_at = ?, last_error = NULL, event_count = ? WHERE id = ?'
    ).run(nowIso(), rows.length, feed.id);

    return { ok: true, count: rows.length };
  } catch (err) {
    const message = err?.message || String(err);
    // Keep the previously cached events: a stale calendar beats a blank one.
    db.prepare('UPDATE feeds SET last_fetch_at = ?, last_error = ? WHERE id = ?').run(
      nowIso(),
      message,
      feed.id
    );
    console.error(`[ics] feed "${feed.name}" failed: ${message}`);
    return { ok: false, error: message };
  }
}

export async function syncAllFeeds() {
  const feeds = db.prepare('SELECT * FROM feeds WHERE enabled = 1').all();
  const results = [];
  for (const feed of feeds) {
    results.push({ feed: feed.name, ...(await syncFeed(feed)) });
  }
  return results;
}

let timer = null;

export function startFeedPolling() {
  const run = async () => {
    await syncAllFeeds().catch((err) => console.error('[ics] sync failed', err));
    const minutes = Math.max(1, Number(getSetting('feed_poll_minutes')) || 15);
    timer = setTimeout(run, minutes * 60 * 1000);
    timer.unref?.();
  };
  // Give the HTTP server a moment to come up before hitting the network.
  timer = setTimeout(run, 2000);
  timer.unref?.();
}

export function stopFeedPolling() {
  if (timer) clearTimeout(timer);
  timer = null;
}
