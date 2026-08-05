import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../lib/useAuth.jsx';
import {
  formatEventTime,
  formatShortDate,
  toDateInputValue,
  toLocalInputValue,
} from '../lib/dates.js';

const COLORS = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185'];

const emptyForm = () => ({
  title: '',
  location: '',
  description: '',
  allDay: false,
  startsAt: toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)),
  endsAt: '',
  startDate: toDateInputValue(),
  endDate: '',
  color: COLORS[0],
});

export default function EventsPage() {
  const { can } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/events?days=120');
      setEvents(data.events);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const canAdd = can('canAddEvents');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Calendar</h1>
        <p className="mt-1 text-sm text-slate-400">
          {canAdd
            ? 'Events you add here show on the frame alongside the subscribed calendars.'
            : 'You don’t have permission to add events. Ask an admin to enable it.'}
        </p>
      </div>

      {canAdd && !editing && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setEditing({ ...emptyForm() })}>
            + New event
          </button>
          <PasteAppointment onAdded={load} />
        </div>
      )}

      {editing && (
        <EventForm
          value={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-900" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="card text-center text-slate-400">
          <p>No family events coming up.</p>
          <p className="mt-1 text-sm text-slate-600">
            Subscribed calendar feeds still show on the frame.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5"
            >
              <span
                className="h-10 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: event.color || COLORS[0] }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{event.title}</p>
                <p className="truncate text-sm text-slate-400">
                  {formatShortDate(event.startsAt, { allDay: event.allDay })} ·{' '}
                  {formatEventTime(event)}
                  {event.location ? ` · ${event.location}` : ''}
                </p>
                {event.createdByName && (
                  <p className="mt-0.5 text-xs text-slate-600">Added by {event.createdByName}</p>
                )}
              </div>
              {event.canEdit && (
                <div className="flex shrink-0 gap-1.5">
                  <button
                    className="rounded-lg px-2.5 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    onClick={() => setEditing(toFormValue(event))}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded-lg px-2.5 py-1.5 text-sm text-rose-400 hover:bg-rose-950/50"
                    onClick={async () => {
                      if (!confirm(`Delete “${event.title}”?`)) return;
                      await api.del(`/events/${event.id}`);
                      load();
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Paste a doctor's-office confirmation email/text; the server extracts the
 * appointment and either adds it or queues it for admin review.
 */
function PasteAppointment({ onAdded }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      const data = await api.post('/ingest/paste', { text });
      const status = data.item.status;
      setResult({
        tone: status === 'added' ? 'ok' : status === 'needs_review' ? 'ok' : 'error',
        text:
          status === 'added'
            ? `Added: ${data.item.extracted?.title || 'appointment'}`
            : status === 'needs_review'
              ? 'Found it — an admin will confirm before it shows on the frame.'
              : data.item.error || 'No appointment found in that text.',
      });
      if (status === 'added') {
        setText('');
        onAdded();
      }
    } catch (err) {
      setResult({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        Paste appointment text
      </button>
    );
  }

  return (
    <div className="card w-full space-y-3">
      <p className="text-sm text-slate-400">
        Paste a confirmation email or text from a doctor's office and we'll pull out the
        appointment.
      </p>
      <textarea
        className="field min-h-28 font-mono text-sm"
        placeholder="e.g. Your appointment with Dr. Smith is on Thursday, Aug 14 at 2:30 PM…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {result && (
        <p
          className={[
            'text-sm',
            result.tone === 'ok' ? 'text-emerald-400' : 'text-rose-400',
          ].join(' ')}
        >
          {result.text}
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !text.trim()} onClick={submit}>
          {busy ? 'Reading…' : 'Extract appointment'}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Server shape → form shape. All-day dates are UTC-anchored, so slice the ISO. */
function toFormValue(event) {
  const base = emptyForm();
  if (event.allDay) {
    // The stored end is exclusive (midnight of the following day); show the
    // last day the event actually covers.
    const endExclusive = new Date(event.endsAt);
    const lastDay = new Date(endExclusive.getTime() - 86400000);
    return {
      ...base,
      id: event.id,
      title: event.title,
      location: event.location || '',
      description: event.description || '',
      allDay: true,
      color: event.color || COLORS[0],
      startDate: event.startsAt.slice(0, 10),
      endDate: lastDay.toISOString().slice(0, 10),
    };
  }
  return {
    ...base,
    id: event.id,
    title: event.title,
    location: event.location || '',
    description: event.description || '',
    allDay: false,
    color: event.color || COLORS[0],
    startsAt: toLocalInputValue(new Date(event.startsAt)),
    endsAt: toLocalInputValue(new Date(event.endsAt)),
  };
}

function EventForm({ value, onCancel, onSaved }) {
  const [form, setForm] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const update = (key) => (e) => {
    const next = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: next }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');

    const payload = {
      title: form.title,
      location: form.location,
      description: form.description,
      allDay: form.allDay,
      color: form.color,
      startsAt: form.allDay ? form.startDate : form.startsAt,
      endsAt: form.allDay ? form.endDate || form.startDate : form.endsAt || undefined,
    };

    try {
      if (form.id) await api.patch(`/events/${form.id}`, payload);
      else await api.post('/events', payload);
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4">
      <h2 className="font-medium">{form.id ? 'Edit event' : 'New event'}</h2>
      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div>
        <label className="label" htmlFor="e-title">
          Title
        </label>
        <input id="e-title" className="field" value={form.title} onChange={update('title')} required />
      </div>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={form.allDay}
          onChange={update('allDay')}
          className="h-4 w-4 rounded border-slate-600 bg-slate-900 accent-sky-500"
        />
        All day
      </label>

      {form.allDay ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="e-start-date">
              Starts
            </label>
            <input
              id="e-start-date"
              type="date"
              className="field"
              value={form.startDate}
              onChange={update('startDate')}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="e-end-date">
              Ends <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <input
              id="e-end-date"
              type="date"
              className="field"
              value={form.endDate}
              onChange={update('endDate')}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="e-start">
              Starts
            </label>
            <input
              id="e-start"
              type="datetime-local"
              className="field"
              value={form.startsAt}
              onChange={update('startsAt')}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="e-end">
              Ends <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <input
              id="e-end"
              type="datetime-local"
              className="field"
              value={form.endsAt}
              onChange={update('endsAt')}
            />
          </div>
        </div>
      )}

      <div>
        <label className="label" htmlFor="e-location">
          Location <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <input id="e-location" className="field" value={form.location} onChange={update('location')} />
      </div>

      <div>
        <span className="label">Colour on the frame</span>
        <div className="flex gap-2">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Colour ${color}`}
              onClick={() => setForm((f) => ({ ...f, color }))}
              className={[
                'h-8 w-8 rounded-full transition',
                form.color === color ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : '',
              ].join(' ')}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : form.id ? 'Save changes' : 'Add to frame'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
