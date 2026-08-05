import { useMemo, useState } from 'react';
import { dayKey, formatEventTime, todayKey } from '../lib/dates.js';

const WEEKDAYS_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** YYYY-MM-DD for a local date, without UTC round-tripping. */
function keyOf(year, month, day) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/**
 * Builds the 6×7 grid for a month. Always six rows so the calendar doesn't
 * change height between months — on a wall display that jump is very visible.
 */
function buildGrid(year, month, weekStartsOn) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(year, month, 1 - offset);

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return {
      key: keyOf(date.getFullYear(), date.getMonth(), date.getDate()),
      day: date.getDate(),
      inMonth: date.getMonth() === month,
    };
  });
}

export default function MonthCalendar({
  events,
  timezone,
  clock24,
  weekStartsOn = 1,
  canAddEvents,
  onAddEvent,
}) {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selected, setSelected] = useState(null);

  const today = todayKey(timezone);
  const grid = useMemo(
    () => buildGrid(cursor.year, cursor.month, weekStartsOn),
    [cursor, weekStartsOn]
  );

  // Group events by day once, then look each cell up.
  const byDay = useMemo(() => {
    const map = new Map();
    for (const event of events) {
      const key = dayKey(event.startsAt, { allDay: event.allDay, timezone });
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(event);
    }
    return map;
  }, [events, timezone]);

  const weekdays = useMemo(
    () => WEEKDAYS_SUN.slice(weekStartsOn).concat(WEEKDAYS_SUN.slice(0, weekStartsOn)),
    [weekStartsOn]
  );

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const step = (delta) =>
    setCursor(({ year, month }) => {
      const next = new Date(year, month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });

  const jumpToToday = () => setCursor({ year: now.getFullYear(), month: now.getMonth() });
  const isCurrentMonth = cursor.year === now.getFullYear() && cursor.month === now.getMonth();

  return (
    <div className="flex h-full flex-col">
      <header className="mb-4 flex shrink-0 items-center gap-3">
        <h2 className="flex-1 text-3xl font-semibold tracking-tight text-white">{monthLabel}</h2>
        {!isCurrentMonth && (
          <button
            onClick={jumpToToday}
            className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 active:bg-white/10"
          >
            Today
          </button>
        )}
        <NavButton label="Previous month" onClick={() => step(-1)} glyph="‹" />
        <NavButton label="Next month" onClick={() => step(1)} glyph="›" />
      </header>

      <div className="mb-1.5 grid shrink-0 grid-cols-7 gap-1.5">
        {weekdays.map((name) => (
          <div
            key={name}
            className="text-center text-xs font-semibold uppercase tracking-[0.15em] text-slate-500"
          >
            {name}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1.5">
        {grid.map((cell) => {
          const dayEvents = byDay.get(cell.key) || [];
          const isToday = cell.key === today;
          return (
            <button
              key={cell.key}
              onClick={() => setSelected(cell.key)}
              className={[
                'flex min-h-0 flex-col overflow-hidden rounded-xl border p-1.5 text-left transition',
                isToday
                  ? 'border-sky-500/60 bg-sky-500/10'
                  : 'border-slate-800/80 active:bg-white/5',
                cell.inMonth ? 'bg-slate-900/40' : 'bg-transparent opacity-40',
              ].join(' ')}
            >
              <span
                className={[
                  'mb-1 shrink-0 text-sm font-medium tabular-nums',
                  isToday ? 'text-sky-300' : 'text-slate-400',
                ].join(' ')}
              >
                {cell.day}
              </span>
              <span className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map((event) => (
                  <span
                    key={event.id}
                    className="truncate rounded px-1 py-0.5 text-xs leading-tight text-slate-100"
                    style={{
                      backgroundColor: `${event.color || (event.source === 'local' ? '#34d399' : '#60a5fa')}33`,
                      borderLeft: `2px solid ${event.color || (event.source === 'local' ? '#34d399' : '#60a5fa')}`,
                    }}
                  >
                    {event.title}
                  </span>
                ))}
                {dayEvents.length > 3 && (
                  <span className="px-1 text-xs text-slate-500">+{dayEvents.length - 3} more</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <DaySheet
          dayKeyValue={selected}
          events={byDay.get(selected) || []}
          timezone={timezone}
          clock24={clock24}
          canAddEvents={canAddEvents}
          onAdd={() => {
            const key = selected;
            setSelected(null);
            onAddEvent(key);
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function NavButton({ label, onClick, glyph }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="grid h-12 w-12 place-items-center rounded-full border border-slate-700 text-2xl text-slate-300 transition active:bg-white/10"
    >
      {glyph}
    </button>
  );
}

/** Tapping a day opens this: what's on, plus a quick-add button. */
function DaySheet({ dayKeyValue, events, timezone, clock24, canAddEvents, onAdd, onClose }) {
  const heading = new Date(`${dayKeyValue}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-8"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-2xl font-semibold text-white">{heading}</h3>

        {events.length === 0 ? (
          <p className="mt-4 text-slate-500">Nothing scheduled.</p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {events.map((event) => (
              <li key={event.id} className="flex gap-3">
                <span
                  className="mt-1 h-full w-1 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      event.color || (event.source === 'local' ? '#34d399' : '#60a5fa'),
                  }}
                />
                <div className="min-w-0">
                  <p className="text-lg font-medium text-slate-100">{event.title}</p>
                  <p className="text-sm text-slate-400">
                    {formatEventTime(event, { clock24, timezone })}
                    {event.location ? ` · ${event.location}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex gap-2">
          {canAddEvents && (
            <button onClick={onAdd} className="btn-primary flex-1 py-3 text-base">
              + Add an event
            </button>
          )}
          <button onClick={onClose} className="btn-ghost flex-1 py-3 text-base">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
