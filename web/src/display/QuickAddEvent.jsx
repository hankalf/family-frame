import { useState } from 'react';
import { api } from '../api.js';

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

/** Half-hour slots; the frame is for family logistics, not minute precision. */
const TIMES = Array.from({ length: 32 }, (_, i) => {
  const minutes = 6 * 60 + i * 30; // 06:00 → 21:30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

const displayTime = (value, clock24) => {
  const [h, m] = value.split(':').map(Number);
  if (clock24) return value;
  const suffix = h < 12 ? 'am' : 'pm';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}${suffix}`;
};

/**
 * Add an event straight from the wall. Ships its own keyboard because Chromium
 * on a Pi kiosk has no reliable on-screen keyboard, and a wall frame has no
 * physical one.
 */
export default function QuickAddEvent({ dateKey, clock24, onSaved, onClose }) {
  const [title, setTitle] = useState('');
  const [shift, setShift] = useState(true);
  const [time, setTime] = useState(null); // null = all day
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const heading = new Date(`${dateKey}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  const type = (char) => {
    setTitle((current) => current + (shift ? char.toUpperCase() : char));
    setShift(false);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/events/from-display', {
        title,
        date: dateKey,
        time: time ?? undefined,
        allDay: time === null,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 p-6">
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-6">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-2xl font-semibold text-white">New event</h3>
          <span className="text-slate-400">{heading}</span>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-2xl text-white">
          {title || <span className="text-slate-600">Event name…</span>}
          <span className="ml-0.5 animate-pulse text-sky-400">|</span>
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}

        {/* Time */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTime(null)}
            className={[
              'shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium transition',
              time === null ? 'bg-sky-500 text-white' : 'border border-slate-700 text-slate-300',
            ].join(' ')}
          >
            All day
          </button>
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
            {TIMES.map((value) => (
              <button
                key={value}
                onClick={() => setTime(value)}
                className={[
                  'shrink-0 rounded-xl px-3 py-2.5 text-sm font-medium tabular-nums transition',
                  time === value
                    ? 'bg-sky-500 text-white'
                    : 'border border-slate-700 text-slate-300 active:bg-white/10',
                ].join(' ')}
              >
                {displayTime(value, clock24)}
              </button>
            ))}
          </div>
        </div>

        {/* Keyboard */}
        <div className="space-y-1.5">
          {ROWS.map((row, index) => (
            <div key={index} className="flex justify-center gap-1.5">
              {index === 2 && (
                <Key wide onClick={() => setShift((s) => !s)} active={shift}>
                  ⇧
                </Key>
              )}
              {row.map((char) => (
                <Key key={char} onClick={() => type(char)}>
                  {shift ? char.toUpperCase() : char}
                </Key>
              ))}
              {index === 2 && (
                <Key wide onClick={() => setTitle((t) => t.slice(0, -1))}>
                  ⌫
                </Key>
              )}
            </div>
          ))}
          <div className="flex justify-center gap-1.5">
            <Key onClick={() => type('&')}>&amp;</Key>
            <Key onClick={() => type("'")}>'</Key>
            <button
              onClick={() => setTitle((t) => `${t} `)}
              className="h-12 flex-1 rounded-lg bg-slate-800 text-slate-200 transition active:bg-slate-700"
              aria-label="Space"
            >
              space
            </button>
            <Key onClick={() => type('-')}>-</Key>
            <Key onClick={() => type('.')}>.</Key>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            className="btn-primary flex-1 py-3 text-base"
            disabled={busy || !title.trim()}
            onClick={save}
          >
            {busy ? 'Saving…' : 'Add to calendar'}
          </button>
          <button className="btn-ghost flex-1 py-3 text-base" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Key({ children, onClick, wide, active }) {
  return (
    <button
      onClick={onClick}
      className={[
        'h-12 rounded-lg text-lg transition active:bg-slate-700',
        wide ? 'w-16' : 'w-12',
        active ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-200',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
