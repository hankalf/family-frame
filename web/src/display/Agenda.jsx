import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatDayHeading, formatEventTime, groupByDay, todayKey } from '../lib/dates.js';
import { formatLocation } from '../lib/location.js';

const SECTION_GAP = 24; // matches space-y-6

/** Discrete steps rather than a free scale — reliable, and readability from
 *  across a room is the only thing that matters here. */
const TEXT_SIZES = {
  small: { heading: 'text-xs', title: 'text-lg', meta: 'text-sm' },
  normal: { heading: 'text-sm', title: 'text-xl', meta: 'text-base' },
  large: { heading: 'text-base', title: 'text-2xl', meta: 'text-lg' },
  xlarge: { heading: 'text-lg', title: 'text-3xl', meta: 'text-xl' },
};

export default function Agenda({
  events,
  timezone,
  clock24,
  loading,
  columns = 1,
  textSize = 'normal',
  accent = '#38bdf8',
  autoFit = false,
  scale = 100,
}) {
  const groups = useMemo(() => groupByDay(events, timezone), [events, timezone]);
  const today = todayKey(timezone);
  const sizes = TEXT_SIZES[textSize] || TEXT_SIZES.normal;

  /**
   * Auto-fit: show only the day sections that fit completely, so raising the
   * font size trims the list instead of slicing a day in half.
   *
   * Section heights are cached by day so that once we render fewer sections,
   * the next measurement still knows how tall the hidden ones were — otherwise
   * hiding a section would free space, which would show it again, forever.
   */
  const rootRef = useRef(null);
  const heightsRef = useRef(new Map());
  const [fitCount, setFitCount] = useState(null); // null = no limit

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || !autoFit || columns > 1) {
      setFitCount((prev) => (prev === null ? prev : null));
      return;
    }

    for (const child of el.children) {
      const key = child.dataset.dayKey;
      if (key) heightsRef.current.set(key, child.getBoundingClientRect().height);
    }

    const available = el.clientHeight;
    let used = 0;
    let count = 0;
    for (const group of groups) {
      const height = heightsRef.current.get(group.key);
      if (height == null) {
        count = groups.length; // not measured yet — render all, measure next pass
        break;
      }
      const next = used + height + (count ? SECTION_GAP : 0);
      if (next > available && count > 0) break;
      used = next;
      count += 1;
    }

    const limit = Math.max(1, count);
    setFitCount((prev) => (prev === limit ? prev : limit));
  }, [groups, autoFit, columns, textSize, scale, events]);

  const shown = fitCount == null ? groups : groups.slice(0, fitCount);
  const hiddenDays = groups.length - shown.length;

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
      ref={rootRef}
      className={[
        'flex-1 overflow-hidden',
        columns > 1 ? 'grid grid-cols-3 gap-x-10 gap-y-2 content-start' : 'space-y-6',
      ].join(' ')}
    >
      {shown.map((group) => (
        <section
          key={group.key}
          data-day-key={group.key}
          className={columns > 1 ? 'mb-6' : undefined}
        >
          <h2
            className={[
              'mb-2.5 font-semibold uppercase tracking-[0.15em]',
              sizes.heading,
              group.key === today ? '' : 'text-slate-500',
            ].join(' ')}
            style={group.key === today ? { color: accent } : undefined}
          >
            {formatDayHeading(group.key, timezone)}
          </h2>
          <ul className="space-y-2.5">
            {group.events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                timezone={timezone}
                clock24={clock24}
                sizes={sizes}
              />
            ))}
          </ul>
        </section>
      ))}

      {hiddenDays > 0 && (
        <p className={`pt-1 text-slate-600 ${sizes.meta}`}>
          +{hiddenDays} more {hiddenDays === 1 ? 'day' : 'days'}
        </p>
      )}
    </div>
  );
}

function EventRow({ event, timezone, clock24, sizes }) {
  const stripe = event.color || (event.source === 'local' ? '#34d399' : '#60a5fa');
  const place = formatLocation(event.location);

  return (
    <li className="flex gap-3.5">
      <span
        className="mt-1.5 h-[calc(100%-0.5rem)] w-1 shrink-0 rounded-full"
        style={{ backgroundColor: stripe }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate font-medium leading-snug text-slate-100 ${sizes.title}`}>
          {event.title}
        </p>
        <p
          className={`mt-0.5 flex flex-wrap items-center gap-x-2 text-slate-400 ${sizes.meta}`}
        >
          <span className="tabular-nums">{formatEventTime(event, { clock24, timezone })}</span>
          {place && (
            <>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="inline-flex min-w-0 items-center gap-1" title={event.location}>
                <PinIcon />
                <span className="truncate">{place}</span>
              </span>
            </>
          )}
        </p>
      </div>
    </li>
  );
}

function PinIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-70"
      aria-hidden="true"
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}
