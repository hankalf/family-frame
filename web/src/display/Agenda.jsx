import { useMemo } from 'react';
import { formatDayHeading, formatEventTime, groupByDay, todayKey } from '../lib/dates.js';

export default function Agenda({ events, timezone, clock24, loading, columns = 1 }) {
  const groups = useMemo(() => groupByDay(events, timezone), [events, timezone]);
  const today = todayKey(timezone);

  if (loading) {
    return (
      <div className="flex-1 space-y-4 pt-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-800/40" />
        ))}
      </div>
    );
  }

  if (!groups.length) {
    return (
      <div className="flex flex-1 items-center">
        <p className="text-xl text-slate-500">Nothing coming up.</p>
      </div>
    );
  }

  return (
    <div
      className={[
        'flex-1 overflow-hidden',
        columns > 1 ? 'grid grid-cols-3 gap-x-10 gap-y-2 content-start' : 'space-y-6',
      ].join(' ')}
    >
      {groups.map((group) => (
        <section key={group.key} className={columns > 1 ? 'mb-6' : undefined}>
          <h2
            className={[
              'mb-2.5 text-sm font-semibold uppercase tracking-[0.15em]',
              group.key === today ? 'text-sky-400' : 'text-slate-500',
            ].join(' ')}
          >
            {formatDayHeading(group.key, timezone)}
          </h2>
          <ul className="space-y-2.5">
            {group.events.map((event) => (
              <EventRow key={event.id} event={event} timezone={timezone} clock24={clock24} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EventRow({ event, timezone, clock24 }) {
  const accent = event.color || (event.source === 'local' ? '#34d399' : '#60a5fa');

  return (
    <li className="flex gap-3.5">
      <span
        className="mt-1.5 h-[calc(100%-0.5rem)] w-1 shrink-0 rounded-full"
        style={{ backgroundColor: accent }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xl font-medium leading-snug text-slate-100">{event.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-base text-slate-400">
          <span className="tabular-nums">{formatEventTime(event, { clock24, timezone })}</span>
          {event.location && (
            <>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="truncate">{event.location}</span>
            </>
          )}
        </p>
      </div>
    </li>
  );
}
