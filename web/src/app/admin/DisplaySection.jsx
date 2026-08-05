import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import CityPicker from './CityPicker.jsx';

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

      <DisplaysPanel />

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
        <h2 className="font-medium">Weather</h2>
        <p className="-mt-2 text-sm text-slate-400">
          Powered by Open-Meteo — free, no account needed. Pick the town the frame should show.
        </p>

        <CityPicker
          place={draft.weather_label}
          lat={draft.weather_latitude}
          lon={draft.weather_longitude}
          onPick={({ label, latitude, longitude }) =>
            setDraft((d) => ({
              ...d,
              weather_label: label,
              weather_latitude: latitude.toFixed(4),
              weather_longitude: longitude.toFixed(4),
            }))
          }
          onClear={() =>
            setDraft((d) => ({
              ...d,
              weather_label: '',
              weather_latitude: '',
              weather_longitude: '',
            }))
          }
        />

        <Row label="Show weather on the frame">
          <Segmented
            value={draft.weather_enabled}
            onChange={set('weather_enabled')}
            options={[
              { value: 'true', label: 'On' },
              { value: 'false', label: 'Off' },
            ]}
          />
        </Row>
        <Row label="Units">
          <Segmented
            value={draft.weather_units}
            onChange={set('weather_units')}
            options={[
              { value: 'imperial', label: '°F · mph' },
              { value: 'metric', label: '°C · km/h' },
            ]}
          />
        </Row>
        <Row label="Radar map">
          <Segmented
            value={draft.weather_radar_enabled}
            onChange={set('weather_radar_enabled')}
            options={[
              { value: 'true', label: 'On' },
              { value: 'false', label: 'Off' },
            ]}
          />
        </Row>
        <Row label="Refresh every">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="5"
              max="180"
              className="field w-24"
              value={draft.weather_poll_minutes}
              onChange={(e) => set('weather_poll_minutes')(e.target.value)}
            />
            <span className="text-sm text-slate-400">minutes</span>
          </div>
        </Row>
        <Row label="Leave the Weather tab after">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="120"
              className="field w-24"
              value={draft.weather_return_minutes}
              onChange={(e) => set('weather_return_minutes')(e.target.value)}
            />
            <span className="text-sm text-slate-400">minutes (0 = stay)</span>
          </div>
        </Row>

        <WeatherStatus />
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

const LAYOUT_LABELS = {
  sidebar: 'Photos + agenda',
  'photo-only': 'Photos only',
  'calendar-only': 'Calendar only',
  weather: 'Weather',
};

function timeAgo(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

/** Live list of paired screens, fed by each kiosk's 60s heartbeat. */
function DisplaysPanel() {
  const [displays, setDisplays] = useState(null);
  const [renaming, setRenaming] = useState(null); // {id, name}

  const load = useCallback(async () => {
    try {
      const data = await api.get('/displays');
      setDisplays(data.displays);
    } catch {
      /* keep the last list */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-medium">Paired displays</h2>
        <p className="mt-1 text-sm text-slate-400">
          Every screen that has opened the kiosk URL checks in once a minute.
        </p>
      </div>

      {!displays ? (
        <div className="h-16 animate-pulse rounded-xl bg-slate-800/40" />
      ) : displays.length === 0 ? (
        <p className="text-sm text-slate-500">
          No displays have connected yet. Open the kiosk URL on the frame and it will appear here.
        </p>
      ) : (
        <ul className="space-y-2">
          {displays.map((display) => (
            <li
              key={display.id}
              className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-3.5 py-3"
            >
              <span
                title={display.online ? 'Online' : 'Offline'}
                className={[
                  'h-2.5 w-2.5 shrink-0 rounded-full',
                  display.online ? 'bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/60' : 'bg-slate-600',
                ].join(' ')}
              />
              <div className="min-w-0 flex-1">
                {renaming?.id === display.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await api.patch(`/displays/${display.id}`, { name: renaming.name });
                      setRenaming(null);
                      load();
                    }}
                  >
                    <input
                      autoFocus
                      className="field py-1 text-sm"
                      value={renaming.name}
                      onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                      placeholder="e.g. Kitchen frame"
                    />
                    <button className="btn-primary px-3 py-1 text-sm">Save</button>
                  </form>
                ) : (
                  <p className="truncate text-sm font-medium">
                    {display.name || `Display ${display.id.slice(0, 6)}`}
                    {!display.online && (
                      <span className="ml-2 text-xs font-normal text-slate-500">offline</span>
                    )}
                  </p>
                )}
                <p className="truncate text-xs text-slate-500">
                  {display.online ? 'Online' : `Last seen ${timeAgo(display.lastSeen)}`}
                  {display.width ? ` · ${display.width}×${display.height}` : ''}
                  {display.layout ? ` · ${LAYOUT_LABELS[display.layout] || display.layout}` : ''}
                </p>
              </div>
              <button
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                onClick={() =>
                  setRenaming(
                    renaming?.id === display.id ? null : { id: display.id, name: display.name || '' }
                  )
                }
              >
                Rename
              </button>
              <button
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-rose-400 hover:bg-rose-950/50"
                onClick={async () => {
                  if (!confirm('Forget this display? It will re-appear if it is still running.')) return;
                  await api.del(`/displays/${display.id}`);
                  load();
                }}
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Live status line: when weather last updated, or why it didn't. */
function WeatherStatus() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.get('/weather'));
    } catch {
      /* keep the last status */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (!status) return null;

  const temp = status.weather?.current?.temp;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-slate-800 pt-3">
      <div className="min-w-0 flex-1 text-sm">
        {status.error ? (
          <p className="text-rose-400">Last fetch failed: {status.error}</p>
        ) : status.fetchedAt ? (
          <p className={status.stale ? 'text-amber-300' : 'text-slate-400'}>
            {Number.isFinite(temp) ? `${Math.round(temp)}° · ` : ''}
            updated {timeAgo(status.fetchedAt)}
            {status.stale ? ' (stale)' : ''}
          </p>
        ) : (
          <p className="text-slate-500">No reading yet.</p>
        )}
      </div>
      <button
        className="btn-ghost text-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await api.post('/weather/refresh');
            setStatus(result);
            if (result.skipped) alert(result.reason);
          } catch (err) {
            alert(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Checking…' : 'Refresh now'}
      </button>
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
