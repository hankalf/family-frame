import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { formatShortDate } from '../../lib/dates.js';

const STATUS_BADGE = {
  needs_review: ['Needs review', 'bg-amber-500/15 text-amber-300'],
  added: ['Added', 'bg-emerald-500/15 text-emerald-300'],
  dismissed: ['Dismissed', 'bg-slate-700/40 text-slate-400'],
  failed: ['Failed', 'bg-rose-500/15 text-rose-300'],
  pending: ['Processing', 'bg-sky-500/15 text-sky-300'],
};

export default function AppointmentsSection() {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [inbox, settingsData] = await Promise.all([
        api.get('/ingest/inbox'),
        api.get('/settings'),
      ]);
      setData(inbox);
      setSettings(settingsData.settings);
      setDraft(settingsData.settings);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!data || !settings) {
    return error ? (
      <p className="text-sm text-rose-400">{error}</p>
    ) : (
      <div className="h-40 animate-pulse rounded-2xl bg-slate-900" />
    );
  }

  const webhookUrl = `${window.location.origin}/api/ingest/hook/${data.ingestSecret}`;
  const gmailKeys = ['gmail_address', 'gmail_app_password', 'gmail_poll_minutes'];
  const dirty = [...gmailKeys, 'ingest_auto_add'].some((k) => draft[k] !== settings[k]);

  const save = async () => {
    setBusy(true);
    try {
      const updates = {};
      for (const key of [...gmailKeys, 'ingest_auto_add']) updates[key] = draft[key];
      await api.put('/settings', { settings: updates });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-rose-400">{error}</p>}

      {!data.llmAvailable && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200/80">
          Running with the basic date parser. For much better extraction, set{' '}
          <code className="text-amber-200">ANTHROPIC_API_KEY</code> in the server's environment and
          restart it.
        </div>
      )}

      <section className="card space-y-3">
        <h2 className="font-medium">Texts from your phone</h2>
        <p className="text-sm text-slate-400">
          Install an SMS-forwarder app (e.g. "SMS to URL Forwarder" on Android), filter it to your
          clinics' numbers, and point it at this URL with a JSON or form body containing{' '}
          <code>text</code> (and optionally <code>from</code>):
        </p>
        <div className="flex gap-2">
          <input readOnly className="field flex-1 font-mono text-xs" value={webhookUrl} />
          <button className="btn-ghost shrink-0" onClick={() => navigator.clipboard?.writeText(webhookUrl)}>
            Copy
          </button>
        </div>
        <p className="text-xs text-slate-600">
          Keep this URL private — anyone with it can add items to the review queue.
        </p>
      </section>

      <section className="card space-y-4">
        <h2 className="font-medium">Gmail</h2>
        <div className="-mt-2 space-y-1.5 text-sm text-slate-400">
          <p>
            Create a free Gmail just for the frame (e.g.{' '}
            <code className="text-slate-300">smithframe@gmail.com</code>) and auto-forward
            appointment emails from your real inbox to it. The frame checks it every few minutes.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-500">
            <li>On the new Gmail account, turn on 2-step verification.</li>
            <li>
              Go to <span className="text-slate-400">myaccount.google.com → Security → App
              passwords</span> and create one — that 16-character code goes below (not the normal
              password).
            </li>
            <li>
              In your own Gmail: Settings → Filters → create a filter for your clinics' addresses
              → "Forward to" the frame's address.
            </li>
          </ol>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Gmail address"
            value={draft.gmail_address}
            onChange={(v) => setDraft((d) => ({ ...d, gmail_address: v }))}
            placeholder="smithframe@gmail.com"
            mono
          />
          <Field
            label="App password"
            type="password"
            value={draft.gmail_app_password}
            onChange={(v) => setDraft((d) => ({ ...d, gmail_app_password: v }))}
            placeholder="16-character app password"
            mono
          />
          <Field
            label="Check every (minutes)"
            value={draft.gmail_poll_minutes}
            onChange={(v) => setDraft((d) => ({ ...d, gmail_poll_minutes: v }))}
          />
        </div>
        {draft.gmail_address &&
          !/@(gmail\.com|googlemail\.com)$/i.test(draft.gmail_address.trim()) && (
            <p className="text-xs text-amber-300/80">
              That doesn't look like a Gmail address — this connects to Gmail's servers only.
              (Google Workspace addresses on your own domain also work.)
            </p>
          )}
        <div className="flex items-center gap-3">
          <button
            className="btn-ghost text-sm"
            onClick={async () => {
              const result = await api.post('/ingest/poll-email');
              alert(
                result.skipped
                  ? 'IMAP is not configured yet (or a check is already running).'
                  : result.error
                    ? `Connection failed: ${result.error}`
                    : `Checked the mailbox — processed ${result.processed} new message(s).`
              );
              load();
            }}
          >
            Test connection / check now
          </button>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">Behaviour</h2>
        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span className="text-slate-300">
            Add confidently-extracted appointments straight to the calendar
            <span className="block text-xs text-slate-500">
              Off = everything waits here for your approval first.
            </span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-sky-500"
            checked={draft.ingest_auto_add === 'true'}
            onChange={(e) =>
              setDraft((d) => ({ ...d, ingest_auto_add: e.target.checked ? 'true' : 'false' }))
            }
          />
        </label>
      </section>

      {dirty && (
        <div className="sticky bottom-4 flex justify-end">
          <button className="btn-primary shadow-xl" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">
          Inbox
          {data.reviewCount > 0 && (
            <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
              {data.reviewCount} to review
            </span>
          )}
        </h2>
        {data.items.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing received yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.items.map((item) => (
              <InboxRow key={item.id} item={item} onChanged={load} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', mono }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type={type}
        className={`field ${mono ? 'font-mono text-sm' : ''}`}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
    </div>
  );
}

function InboxRow({ item, onChanged }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [badgeLabel, badgeClass] = STATUS_BADGE[item.status] || STATUS_BADGE.pending;
  const extracted = item.extracted;

  const act = async (fn) => {
    setError('');
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900/40">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 p-3.5 text-left">
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${badgeClass}`}>
          {badgeLabel}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {extracted?.title || item.subject || item.body.slice(0, 60)}
          </span>
          <span className="block truncate text-xs text-slate-500">
            {item.source} · {item.sender || 'unknown sender'} · {formatShortDate(item.receivedAt)}
            {extracted?.date && ` → ${extracted.date}${extracted.time ? ` ${extracted.time}` : ''}`}
          </span>
        </span>
        <span className="text-slate-600">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-800 p-3.5">
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-slate-400">
            {item.body}
          </pre>
          {extracted?.is_appointment && (
            <p className="text-sm text-slate-300">
              Extracted: <span className="font-medium">{extracted.title}</span> · {extracted.date}
              {extracted.time && ` at ${extracted.time}`}
              {extracted.location && ` · ${extracted.location}`}
              <span className="ml-2 text-xs text-slate-500">
                ({extracted.confidence} confidence, {extracted.method})
              </span>
            </p>
          )}
          {item.error && <p className="text-sm text-slate-500">{item.error}</p>}
          <div className="flex flex-wrap gap-2">
            {item.status === 'needs_review' && extracted?.is_appointment && (
              <button className="btn-primary text-sm" onClick={() => act(() => api.post(`/ingest/inbox/${item.id}/approve`))}>
                Add to calendar
              </button>
            )}
            {item.status !== 'dismissed' && item.status !== 'added' && (
              <button className="btn-ghost text-sm" onClick={() => act(() => api.post(`/ingest/inbox/${item.id}/dismiss`))}>
                Dismiss
              </button>
            )}
            <button className="btn-danger ml-auto text-sm" onClick={() => act(() => api.del(`/ingest/inbox/${item.id}`))}>
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
