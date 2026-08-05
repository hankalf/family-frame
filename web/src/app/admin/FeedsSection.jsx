import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { formatShortDate } from '../../lib/dates.js';

export default function FeedsSection() {
  const [feeds, setFeeds] = useState([]);
  const [form, setForm] = useState({ name: '', url: '', color: '#60a5fa' });
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.get('/feeds');
      setFeeds(data.feeds);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.post('/feeds', form);
      if (!result.sync?.ok) {
        setError(
          `Feed saved, but the first fetch failed: ${result.sync?.error || 'unknown error'}. ` +
            'Check the URL is a public/secret .ics address, not the calendar’s web page.'
        );
      }
      setForm({ name: '', url: '', color: '#60a5fa' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <div>
          <h2 className="font-medium">Subscribe to a calendar</h2>
          <p className="mt-1 text-sm text-slate-400">
            Paste an iCal address (.ics). From iCloud: Calendar → share → Public Calendar. From
            Outlook: Settings → Shared calendars → Publish. webcal:// links work too.
          </p>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <form onSubmit={add} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr_auto]">
            <div>
              <label className="label" htmlFor="f-name">
                Name
              </label>
              <input
                id="f-name"
                className="field"
                placeholder="e.g. School"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="f-url">
                iCal URL
              </label>
              <input
                id="f-url"
                className="field font-mono text-sm"
                placeholder="webcal://…  or  https://….ics"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="f-color">
                Colour
              </label>
              <input
                id="f-color"
                type="color"
                className="h-11 w-14 cursor-pointer rounded-xl border border-slate-700 bg-slate-900"
                value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
              />
            </div>
          </div>
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Checking feed…' : 'Add calendar'}
          </button>
        </form>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Subscribed calendars</h2>
          {feeds.length > 0 && (
            <button
              className="btn-ghost text-sm"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                try {
                  await api.post('/feeds/sync');
                  await load();
                } finally {
                  setSyncing(false);
                }
              }}
            >
              {syncing ? 'Refreshing…' : 'Refresh now'}
            </button>
          )}
        </div>

        {feeds.length === 0 ? (
          <p className="text-sm text-slate-500">No calendars subscribed yet.</p>
        ) : (
          <ul className="space-y-2">
            {feeds.map((feed) => (
              <li
                key={feed.id}
                className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5"
              >
                <span
                  className="h-10 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: feed.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {feed.name}
                    {!feed.enabled && (
                      <span className="ml-2 text-xs font-normal text-slate-500">paused</span>
                    )}
                  </p>
                  {feed.lastError ? (
                    <p className="truncate text-sm text-rose-400" title={feed.lastError}>
                      Fetch failing: {feed.lastError}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500">
                      {feed.eventCount} events
                      {feed.lastFetchAt && ` · updated ${formatShortDate(feed.lastFetchAt)}`}
                    </p>
                  )}
                </div>
                <button
                  className="btn-ghost text-sm"
                  onClick={async () => {
                    await api.patch(`/feeds/${feed.id}`, { enabled: !feed.enabled });
                    load();
                  }}
                >
                  {feed.enabled ? 'Pause' : 'Resume'}
                </button>
                <button
                  className="text-rose-400 hover:text-rose-300"
                  aria-label={`Remove ${feed.name}`}
                  onClick={async () => {
                    if (!confirm(`Remove the “${feed.name}” calendar?`)) return;
                    await api.del(`/feeds/${feed.id}`);
                    load();
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
