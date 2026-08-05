/**
 * All-day events are stored at midnight UTC of their calendar date, so they
 * must be formatted in UTC or they slide a day in western timezones. Timed
 * events are real instants and get formatted in the display timezone.
 */

const tzOpts = (timezone) => (timezone ? { timeZone: timezone } : {});

export function formatTime(iso, { clock24 = true, timezone } = {}) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !clock24,
    ...tzOpts(timezone),
  });
}

export function formatEventTime(event, opts = {}) {
  if (event.allDay) return 'All day';
  const start = formatTime(event.startsAt, opts);
  if (!event.endsAt) return start;
  const end = formatTime(event.endsAt, opts);
  return start === end ? start : `${start} – ${end}`;
}

/** A stable YYYY-MM-DD key for grouping, respecting the all-day rule above. */
export function dayKey(iso, { allDay = false, timezone } = {}) {
  const date = new Date(iso);
  if (allDay) return date.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...tzOpts(timezone),
  }).format(date);
  return parts; // en-CA gives YYYY-MM-DD
}

export function todayKey(timezone) {
  return dayKey(new Date().toISOString(), { timezone });
}

export function formatDayHeading(key, timezone) {
  // Parse as UTC noon so the label can't slip to the neighbouring day.
  const date = new Date(`${key}T12:00:00Z`);
  const today = todayKey(timezone);
  const tomorrow = dayKey(new Date(Date.now() + 86400000).toISOString(), { timezone });

  if (key === today) return 'Today';
  if (key === tomorrow) return 'Tomorrow';

  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatShortDate(iso, { allDay = false, timezone } = {}) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(allDay ? { timeZone: 'UTC' } : tzOpts(timezone)),
  });
}

/** Groups a flat agenda into [{ key, events }] ordered by date. */
export function groupByDay(events, timezone) {
  const groups = new Map();
  for (const event of events) {
    const key = dayKey(event.startsAt, { allDay: event.allDay, timezone });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, list]) => ({ key, events: list }));
}

/** Local `YYYY-MM-DDTHH:mm` string for prefilling datetime-local inputs. */
export function toLocalInputValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function toDateInputValue(date = new Date()) {
  return toLocalInputValue(date).slice(0, 10);
}

/** True when `HH:MM` now falls inside the night window (which may wrap midnight). */
export function isNightTime(startHHMM, endHHMM, now = new Date()) {
  const toMinutes = (value) => {
    const [h, m] = String(value || '').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };
  const start = toMinutes(startHHMM);
  const end = toMinutes(endHHMM);
  if (start === null || end === null || start === end) return false;

  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}
