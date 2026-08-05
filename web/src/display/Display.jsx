import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, getDisplayToken, setDisplayToken } from '../api.js';
import { isNightTime } from '../lib/dates.js';
import PhotoFrame from './PhotoFrame.jsx';
import Agenda from './Agenda.jsx';
import Clock from './Clock.jsx';

// Data refresh, not page reload — the slideshow keeps its place. Cheap against
// the LAN server; note that external .ics feeds still only change as often as
// the server polls them (feed_poll_minutes).
const PLAYLIST_REFRESH_MS = 15 * 1000;
const AGENDA_REFRESH_MS = 15 * 1000;
const SETTINGS_REFRESH_MS = 60 * 1000;

function usePolled(fetcher, intervalMs, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const savedFetcher = useRef(fetcher);
  savedFetcher.current = fetcher;

  const load = useCallback(async () => {
    try {
      setData(await savedFetcher.current());
      setError(null);
    } catch (err) {
      // Keep showing the last good data — a dropped Wi-Fi link shouldn't blank
      // the wall. Only surface an error if we never loaded anything.
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, reload: load };
}

export default function Display() {
  const [params, setParams] = useSearchParams();
  const [token, setToken] = useState(getDisplayToken());

  // A token in the URL is stored once, then stripped so the screen isn't
  // showing the secret to the room.
  useEffect(() => {
    const fromUrl = params.get('token');
    if (fromUrl) {
      setDisplayToken(fromUrl);
      setToken(fromUrl);
      const next = new URLSearchParams(params);
      next.delete('token');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const settingsQuery = usePolled(
    async () => (await api.get('/settings/display')).settings,
    SETTINGS_REFRESH_MS,
    [token]
  );
  const settings = settingsQuery.data;

  const agendaDays = Number(settings?.agenda_days) || 10;
  const agendaQuery = usePolled(
    async () => (await api.get(`/events/agenda?days=${agendaDays}`)).events,
    AGENDA_REFRESH_MS,
    [token, agendaDays]
  );

  const playlistQuery = usePolled(
    async () => (await api.get('/photos/playlist')).photos,
    PLAYLIST_REFRESH_MS,
    [token]
  );

  const [isNight, setIsNight] = useState(false);
  useEffect(() => {
    if (!settings) return;
    const check = () =>
      setIsNight(isNightTime(settings.night_start, settings.night_end));
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [settings]);

  // Keep the screen awake. Browsers only grant this after the page is visible,
  // and drop it on tab switch, so re-request on visibility change.
  useEffect(() => {
    let sentinel = null;
    let cancelled = false;

    const acquire = async () => {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        /* denied — kiosk-mode screen blanking must be handled by the OS */
      }
    };

    acquire();
    const onVisible = () => {
      if (!cancelled && document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release?.().catch(() => {});
    };
  }, []);

  // Touch override for the layout. The admin's setting is the default; a new
  // admin value (changed remotely) takes back over until the screen is touched.
  const [localLayout, setLocalLayout] = useState(() => {
    try {
      return localStorage.getItem('frame.layout') || null;
    } catch {
      return null;
    }
  });
  const serverLayout = settings?.layout || 'sidebar';
  useEffect(() => {
    try {
      const lastSeen = localStorage.getItem('frame.layout.server');
      if (lastSeen !== serverLayout) {
        localStorage.setItem('frame.layout.server', serverLayout);
        localStorage.removeItem('frame.layout');
        setLocalLayout(null);
      }
    } catch {
      /* storage unavailable */
    }
  }, [serverLayout]);

  const pickLayout = (value) => {
    setLocalLayout(value);
    try {
      localStorage.setItem('frame.layout', value);
    } catch {
      /* storage unavailable */
    }
  };

  const unauthorized =
    settingsQuery.error?.status === 401 || playlistQuery.error?.status === 401;

  if (!token || unauthorized) return <TokenPrompt hasToken={!!token} />;
  if (!settings) return <Splash message="Waking up…" />;

  const layout = localLayout || serverLayout;
  const showPhotos = layout !== 'calendar-only';
  const showCalendar = layout !== 'photo-only';

  return (
    <div className="kiosk relative h-screen w-screen overflow-hidden bg-slate-950">
      {showPhotos && (
        <PhotoFrame
          photos={playlistQuery.data || []}
          slideSeconds={Number(settings.slide_seconds) || 25}
          transition={settings.transition}
          shuffle={settings.shuffle === 'true'}
          showCaptions={settings.show_captions === 'true'}
          inset={showCalendar}
        />
      )}

      {showCalendar && (
        <aside
          className={[
            'absolute inset-y-0 left-0 z-20 flex w-[30rem] max-w-[38vw] flex-col gap-6 p-9',
            showPhotos
              ? 'bg-gradient-to-r from-slate-950 via-slate-950/95 to-transparent'
              : 'w-full max-w-none bg-slate-950',
          ].join(' ')}
        >
          <Clock
            clock24={settings.clock_24h === 'true'}
            timezone={settings.timezone}
            wide={!showPhotos}
          />
          <Agenda
            events={agendaQuery.data || []}
            timezone={settings.timezone}
            clock24={settings.clock_24h === 'true'}
            loading={!agendaQuery.data}
            columns={showPhotos ? 1 : 3}
          />
        </aside>
      )}

      <LayoutMenu layout={layout} onPick={pickLayout} />

      {/* Night dimming — a pure overlay so nothing has to re-render. */}
      <div
        className="pointer-events-none absolute inset-0 z-40 bg-black transition-opacity duration-[3000ms]"
        style={{
          opacity: isNight ? 1 - (Number(settings.night_brightness) || 0.12) : 0,
        }}
      />

      <OfflineBadge
        offline={!!(agendaQuery.error || playlistQuery.error || settingsQuery.error)}
      />
    </div>
  );
}

const LAYOUTS = [
  { id: 'calendar-only', label: 'Calendar', icon: CalendarIcon },
  { id: 'sidebar', label: 'Both', icon: SplitIcon },
  { id: 'photo-only', label: 'Photos', icon: PhotoIcon },
];

/**
 * Minimal touch menu, bottom-center. Sits dim so it doesn't draw the eye;
 * any touch/click on the screen wakes it to full opacity for a few seconds.
 */
function LayoutMenu({ layout, onPick }) {
  const [awake, setAwake] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const wake = () => {
      setAwake(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setAwake(false), 6000);
    };
    window.addEventListener('pointerdown', wake, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', wake);
      clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <nav
      aria-label="Display layout"
      className={[
        'absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-full',
        'border border-white/10 bg-slate-950/70 p-1.5 backdrop-blur-md',
        'transition-opacity duration-500',
        awake ? 'opacity-100' : 'opacity-30',
      ].join(' ')}
      style={{ touchAction: 'manipulation' }}
    >
      {LAYOUTS.map(({ id, label, icon: Icon }) => {
        const active = layout === id;
        return (
          <button
            key={id}
            onClick={() => onPick(id)}
            aria-label={`Show ${label.toLowerCase()}`}
            aria-pressed={active}
            className={[
              'flex h-12 min-w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-full px-4',
              'transition select-none',
              active ? 'bg-white/15 text-white' : 'text-slate-400 active:bg-white/10',
            ].join(' ')}
          >
            <Icon />
            <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M10 4v16" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M4 17l5-5 3.5 3.5L15 13l5 4.5" />
    </svg>
  );
}

function Splash({ message }) {
  return (
    <div className="kiosk flex h-screen w-screen items-center justify-center bg-slate-950">
      <p className="animate-pulse text-2xl text-slate-500">{message}</p>
    </div>
  );
}

function TokenPrompt({ hasToken }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-950 p-8">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-semibold text-slate-100">
          {hasToken ? 'This display token is no longer valid' : 'This screen is not paired yet'}
        </h1>
        <p className="mt-4 leading-relaxed text-slate-400">
          Sign in to the companion app on another device, open{' '}
          <span className="text-slate-200">Settings → Display</span>, and copy the kiosk URL. It
          looks like:
        </p>
        <code className="mt-4 block rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-sky-300">
          http://this-machine:4000/display?token=…
        </code>
        <p className="mt-4 text-sm text-slate-500">
          Open that once on this screen and it stays paired.
        </p>
      </div>
    </div>
  );
}

function OfflineBadge({ offline }) {
  const [visible, setVisible] = useState(false);

  // A single failed poll is usually nothing. Only admit to being offline once
  // it has persisted, so a blip doesn't put a badge on the wall.
  useEffect(() => {
    if (!offline) {
      setVisible(false);
      return;
    }
    const id = setTimeout(() => setVisible(true), 90_000);
    return () => clearTimeout(id);
  }, [offline]);

  if (!visible) return null;
  return (
    <div className="absolute bottom-5 right-6 z-40 rounded-full bg-amber-500/15 px-4 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/30">
      Showing saved data — can't reach the server
    </div>
  );
}
