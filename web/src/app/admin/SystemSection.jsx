import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';

const LEVEL_STYLE = {
  error: 'border-rose-900/60 bg-rose-950/30 text-rose-300',
  warn: 'border-amber-900/60 bg-amber-950/30 text-amber-200',
  info: 'border-slate-800 bg-slate-900/40 text-slate-300',
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

export default function SystemSection() {
  const [report, setReport] = useState(null);
  const [storage, setStorage] = useState(null);
  const [backups, setBackups] = useState(null);
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    try {
      const [health, storageReport, backupList, settingsData] = await Promise.all([
        api.get('/system/health-report'),
        api.get('/system/storage'),
        api.get('/backups'),
        api.get('/settings'),
      ]);
      setReport(health);
      setStorage(storageReport);
      setBackups(backupList);
      setSettings(settingsData.settings);
      setDraft(settingsData.settings);
    } catch (err) {
      setNote({ tone: 'error', text: err.message });
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (!report || !backups || !settings || !storage) {
    return <div className="h-40 animate-pulse rounded-2xl bg-slate-900" />;
  }

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: String(value) }));
  const keys = [
    'backup_enabled',
    'backup_path',
    'backup_every_hours',
    'backup_keep',
    'alerts_enabled',
    'alert_email',
  ];
  const dirty = keys.some((k) => draft[k] !== settings[k]);

  const save = async () => {
    setBusy('save');
    try {
      const updates = {};
      for (const key of keys) updates[key] = draft[key];
      await api.put('/settings', { settings: updates });
      await load();
      setNote({ tone: 'ok', text: 'Saved.' });
    } catch (err) {
      setNote({ tone: 'error', text: err.message });
    } finally {
      setBusy('');
    }
  };

  const run = async (label, fn) => {
    setBusy(label);
    setNote(null);
    try {
      const result = await fn();
      setNote({ tone: result?.ok === false ? 'error' : 'ok', text: describe(result) });
      await load();
    } catch (err) {
      setNote({ tone: 'error', text: err.message });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6">
      {note && (
        <p className={`text-sm ${note.tone === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
          {note.text}
        </p>
      )}

      {/* Health */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">
            Health
            <span
              className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                report.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
              }`}
            >
              {report.ok ? 'All good' : 'Needs attention'}
            </span>
          </h2>
          <button
            className="btn-ghost text-sm"
            disabled={busy === 'digest'}
            onClick={() => run('digest', () => api.post('/system/health-report/send'))}
          >
            {busy === 'digest' ? 'Sending…' : 'Email me this report'}
          </button>
        </div>

        {report.issues.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing to report.</p>
        ) : (
          <ul className="space-y-2">
            {report.issues.map((issue, i) => (
              <li
                key={i}
                className={`rounded-xl border px-3.5 py-2.5 text-sm ${LEVEL_STYLE[issue.level]}`}
              >
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-slate-800 pt-3 text-sm sm:grid-cols-4">
          <Stat label="Photos" value={report.stats.photos} />
          <Stat label="Events" value={report.stats.events} />
          <Stat
            label="Displays"
            value={`${report.stats.displaysOnline}/${report.stats.displays} online`}
          />
          <Stat
            label="Last backup"
            value={
              report.stats.lastBackupAt
                ? new Date(report.stats.lastBackupAt).toLocaleDateString()
                : 'never'
            }
          />
        </dl>
      </section>

      {/* Storage */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Storage</h2>
          <button
            className="btn-ghost text-sm"
            disabled={busy === 'cache'}
            onClick={() =>
              run('cache', async () => {
                const result = await api.post('/system/storage/clear-cache');
                setStorage(result.storage);
                return { ok: true, freedCache: result.freed, removed: result.removed };
              })
            }
          >
            {busy === 'cache' ? 'Clearing…' : 'Clear resized copies'}
          </button>
        </div>

        {storage.disk && (
          <div className="space-y-1.5">
            <DiskBar storage={storage} />
            <p className="text-xs text-slate-500">
              {formatBytes(storage.disk.free)} free of {formatBytes(storage.disk.total)} on the
              drive
            </p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <Stat
            label="Photos"
            value={formatBytes(storage.photos.originals)}
            sub={`${storage.photos.files} files`}
          />
          <Stat
            label="Resized copies"
            value={formatBytes(storage.photos.derived)}
            sub="rebuilt on demand"
          />
          <Stat label="Database" value={formatBytes(storage.database)} />
          <Stat
            label="Backups"
            value={formatBytes(storage.backups.unique)}
            sub={
              storage.backups.bytes > storage.backups.unique
                ? `+${formatBytes(storage.backups.bytes - storage.backups.unique)} shared`
                : undefined
            }
          />
        </dl>

        {storage.backups.bytes > storage.backups.unique && (
          <p className="text-xs text-slate-600">
            Backups hardlink the photos, so most of what they appear to contain costs no extra
            disk — only the {formatBytes(storage.backups.unique)} above is additional.
          </p>
        )}

        {storage.byUser.length > 0 && (
          <div className="space-y-2 border-t border-slate-800 pt-3">
            <h3 className="text-sm font-medium text-slate-300">Who's using it</h3>
            <ul className="space-y-1.5">
              {storage.byUser.map((row) => {
                const share = storage.photos.originals
                  ? (row.bytes / storage.photos.originals) * 100
                  : 0;
                return (
                  <li key={row.name} className="flex items-center gap-3 text-sm">
                    <span className="w-32 shrink-0 truncate text-slate-300">{row.name}</span>
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <span
                        className="block h-full rounded-full bg-sky-500"
                        style={{ width: `${Math.max(2, share)}%` }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-slate-400">
                      {formatBytes(row.bytes)}
                    </span>
                    <span className="w-14 shrink-0 text-right text-xs tabular-nums text-slate-600">
                      {row.count}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {storage.largest.length > 0 && (
          <details className="border-t border-slate-800 pt-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-300">
              Largest photos
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-slate-500">
              {storage.largest.map((photo) => (
                <li key={photo.id} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate">{photo.name || photo.id}</span>
                  <span className="shrink-0 text-slate-600">{photo.addedBy}</span>
                  <span className="w-16 shrink-0 text-right tabular-nums">
                    {formatBytes(photo.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Alerts */}
      <section className="card space-y-4">
        <h2 className="font-medium">Alerts</h2>
        <p className="-mt-2 text-sm text-slate-400">
          Sent through the Gmail account configured under Appointments — no second login to set
          up. You'll get a weekly summary, plus a note if a display goes dark for an hour.
        </p>
        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span className="text-slate-300">Email me when something breaks</span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-sky-500"
            checked={draft.alerts_enabled === 'true'}
            onChange={(e) => set('alerts_enabled')(e.target.checked ? 'true' : 'false')}
          />
        </label>
        <div>
          <label className="label">Send to</label>
          <input
            className="field font-mono text-sm"
            placeholder="(defaults to the frame's Gmail address)"
            value={draft.alert_email || ''}
            onChange={(e) => set('alert_email')(e.target.value)}
          />
        </div>
      </section>

      {/* Backups */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Backups</h2>
          <button
            className="btn-ghost text-sm"
            disabled={busy === 'backup'}
            onClick={() => run('backup', () => api.post('/backups/run'))}
          >
            {busy === 'backup' ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
        <p className="-mt-2 text-sm text-slate-400">
          Family photos are the only thing here that can't be recreated. Each backup takes a
          consistent database snapshot and hardlinks the photos, so keeping several generations
          costs almost no extra disk.
        </p>

        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span className="text-slate-300">Run backups automatically</span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-sky-500"
            checked={draft.backup_enabled === 'true'}
            onChange={(e) => set('backup_enabled')(e.target.checked ? 'true' : 'false')}
          />
        </label>

        <div>
          <label className="label">Where to store them</label>
          <input
            className="field font-mono text-sm"
            placeholder="(defaults to a folder beside the database)"
            value={draft.backup_path || ''}
            onChange={(e) => set('backup_path')(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-amber-300/70">
            A backup on the same disk won't survive that disk failing. Point this at a mounted
            NAS share, or rsync the folder off the box.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Every</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="168"
                className="field w-24"
                value={draft.backup_every_hours}
                onChange={(e) => set('backup_every_hours')(e.target.value)}
              />
              <span className="text-sm text-slate-400">hours</span>
            </div>
          </div>
          <div>
            <label className="label">Keep</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="90"
                className="field w-24"
                value={draft.backup_keep}
                onChange={(e) => set('backup_keep')(e.target.value)}
              />
              <span className="text-sm text-slate-400">generations</span>
            </div>
          </div>
        </div>

        <p className="break-all text-xs text-slate-600">Storing in: {backups.root}</p>

        {backups.backups.length > 0 && (
          <ul className="space-y-1.5">
            {backups.backups.slice(0, 8).map((backup) => (
              <li
                key={backup.name}
                className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-3.5 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {new Date(backup.createdAt).toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-500">
                    {backup.photos ?? '?'} photos · {formatBytes(backup.bytes)}
                    {!backup.complete && ' · incomplete'}
                  </span>
                </span>
                <a
                  className="btn-ghost shrink-0 text-xs"
                  href={`/api/backups/${backup.name}/database`}
                >
                  Database
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dirty && (
        <div className="sticky bottom-4 flex justify-end">
          <button className="btn-primary shadow-xl" disabled={busy === 'save'} onClick={save}>
            {busy === 'save' ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-200">{value}</dd>
      {sub && <dd className="text-xs text-slate-600">{sub}</dd>}
    </div>
  );
}

/** Where the disk is going: this app's share, everything else, and free space. */
function DiskBar({ storage }) {
  const { total } = storage.disk;
  const segments = [
    { key: 'photos', label: 'Photos', bytes: storage.photos.originals, color: 'bg-sky-500' },
    { key: 'derived', label: 'Resized', bytes: storage.photos.derived, color: 'bg-sky-700' },
    { key: 'backups', label: 'Backups', bytes: storage.backups.unique, color: 'bg-emerald-600' },
    { key: 'db', label: 'Database', bytes: storage.database, color: 'bg-violet-500' },
  ];
  const ours = segments.reduce((sum, s) => sum + s.bytes, 0);
  const other = Math.max(0, storage.disk.used - ours);

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={segment.color}
            style={{ width: `${(segment.bytes / total) * 100}%` }}
            title={`${segment.label}: ${formatBytes(segment.bytes)}`}
          />
        ))}
        <span
          className="bg-slate-700"
          style={{ width: `${(other / total) * 100}%` }}
          title={`Everything else on the drive: ${formatBytes(other)}`}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        {segments.map((segment) => (
          <span key={segment.key} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${segment.color}`} />
            {segment.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-slate-700" />
          Other
        </span>
      </div>
    </div>
  );
}

function describe(result) {
  if (!result) return 'Done.';
  if (result.skipped) return result.reason || 'Skipped.';
  if (result.error) return result.error;
  if (result.freedCache !== undefined) {
    return `Cleared ${result.removed} resized copies (${formatBytes(result.freedCache)}). They rebuild as photos are shown.`;
  }
  if (result.photos !== undefined) {
    return `Backed up ${result.photos} photos (${formatBytes(result.bytes)}).`;
  }
  if (result.to) return `Sent to ${result.to}.`;
  return 'Done.';
}
