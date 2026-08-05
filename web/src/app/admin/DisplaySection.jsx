import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';

export default function DisplaySection() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api.get('/settings');
      setData(result);
      setDraft(result.settings);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return error ? (
      <p className="text-sm text-rose-400">{error}</p>
    ) : (
      <div className="h-40 animate-pulse rounded-2xl bg-slate-900" />
    );
  }

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: String(value) }));
  const dirty = Object.keys(draft).some((key) => draft[key] !== data.settings[key]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put('/settings', { settings: draft });
      await load();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-rose-400">{error}</p>}

      <section className="card space-y-1.5">
        <h2 className="font-medium">Kiosk URL</h2>
        <p className="text-sm text-slate-400">
          Open this once in the browser on the frame (Pi / PC stick). The screen pairs itself and
          remembers.
        </p>
        {data.displayUrls.map((url) => (
          <div key={url} className="mt-2 flex gap-2">
            <input readOnly className="field flex-1 font-mono text-xs" value={url} />
            <button
              className="btn-ghost shrink-0"
              onClick={() => navigator.clipboard?.writeText(url)}
            >
              Copy
            </button>
          </div>
        ))}
        <button
          className="mt-2 text-sm text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
          onClick={async () => {
            if (
              !confirm(
                'Rotate the display token? Every paired screen will need the new URL opened once.'
              )
            )
              return;
            await api.post('/settings/display-token/rotate');
            load();
          }}
        >
          Rotate token (un-pairs all screens)
        </button>
      </section>

      <section className="card space-y-4">
        <h2 className="font-medium">Photo frame</h2>
        <Row label="Seconds per photo">
          <input
            type="number"
            min="3"
            max="600"
            className="field w-28"
            value={draft.slide_seconds}
            onChange={(e) => set('slide_seconds')(e.target.value)}
          />
        </Row>
        <Row label="Transition">
          <Segmented
            value={draft.transition}
            onChange={set('transition')}
            options={[
              { value: 'kenburns', label: 'Slow zoom' },
              { value: 'fade', label: 'Fade' },
            ]}
          />
        </Row>
        <Row label="Shuffle order">
          <Segmented
            value={draft.shuffle}
            onChange={set('shuffle')}
            options={[
              { value: 'true', label: 'On' },
              { value: 'false', label: 'Off' },
            ]}
          />
        </Row>
        <Row label="Show captions">
          <Segmented
            value={draft.show_captions}
            onChange={set('show_captions')}
            options={[
              { value: 'true', label: 'On' },
              { value: 'false', label: 'Off' },
            ]}
          />
        </Row>
        <Row label="New photos need approval">
          <Segmented
            value={draft.require_photo_approval}
            onChange={set('require_photo_approval')}
            options={[
              { value: 'false', label: 'No' },
              { value: 'true', label: 'Yes' },
            ]}
          />
        </Row>
      </section>

      <section className="card space-y-4">
        <h2 className="font-medium">Layout &amp; calendar</h2>
        <Row label="Layout">
          <Segmented
            value={draft.layout}
            onChange={set('layout')}
            options={[
              { value: 'sidebar', label: 'Photos + agenda' },
              { value: 'photo-only', label: 'Photos only' },
              { value: 'calendar-only', label: 'Calendar only' },
            ]}
          />
        </Row>
        <Row label="Agenda shows next">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="60"
              className="field w-24"
              value={draft.agenda_days}
              onChange={(e) => set('agenda_days')(e.target.value)}
            />
            <span className="text-sm text-slate-400">days</span>
          </div>
        </Row>
        <Row label="Clock">
          <Segmented
            value={draft.clock_24h}
            onChange={set('clock_24h')}
            options={[
              { value: 'true', label: '24-hour' },
              { value: 'false', label: '12-hour' },
            ]}
          />
        </Row>
        <Row label="Timezone">
          <input
            className="field w-full max-w-xs font-mono text-sm"
            value={draft.timezone}
            onChange={(e) => set('timezone')(e.target.value)}
            placeholder="e.g. Europe/Stockholm"
          />
        </Row>
      </section>

      <section className="card space-y-4">
        <h2 className="font-medium">Night mode</h2>
        <p className="-mt-2 text-sm text-slate-400">
          The frame dims between these times so it doesn't light up the room.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="time"
            className="field w-32"
            value={draft.night_start}
            onChange={(e) => set('night_start')(e.target.value)}
          />
          <span className="text-slate-500">to</span>
          <input
            type="time"
            className="field w-32"
            value={draft.night_end}
            onChange={(e) => set('night_end')(e.target.value)}
          />
        </div>
        <Row label={`Night brightness: ${Math.round(Number(draft.night_brightness) * 100)}%`}>
          <input
            type="range"
            min="0"
            max="0.6"
            step="0.02"
            className="w-full max-w-xs accent-sky-500"
            value={draft.night_brightness}
            onChange={(e) => set('night_brightness')(e.target.value)}
          />
        </Row>
      </section>

      <section className="card space-y-4">
        <h2 className="font-medium">Photo folder (optional)</h2>
        <p className="-mt-2 text-sm text-slate-400">
          A folder on the server that gets imported automatically — useful with Syncthing, a network
          share, or a USB stick of old photos. Leave empty to disable.
        </p>
        <input
          className="field font-mono text-sm"
          placeholder="e.g. /home/pi/frame-photos or D:\FramePhotos"
          value={draft.photo_folder_path}
          onChange={(e) => set('photo_folder_path')(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <button
            className="btn-ghost text-sm"
            onClick={async () => {
              const result = await api.post('/settings/rescan-folder');
              alert(
                result.skipped
                  ? result.error || 'No folder configured.'
                  : `Imported ${result.added} new photo(s).`
              );
            }}
          >
            Scan now
          </button>
          <span className="text-xs text-slate-600">
            Also runs automatically every {draft.folder_scan_minutes} min.
          </span>
        </div>
        <p className="text-xs text-slate-600">{data.googlePhotos.reason}</p>
      </section>

      <div className="sticky bottom-4 flex justify-end">
        <button className="btn-primary shadow-xl" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-slate-300">{label}</span>
      {children}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-700 bg-slate-900 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={[
            'rounded-lg px-3 py-1.5 text-sm font-medium transition',
            value === option.value ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
