import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, getDisplayToken, setDisplayToken } from '../api.js';
import { isNightTime } from '../lib/dates.js';

import PhotoFrame from './PhotoFrame.jsx';
import Agenda from './Agenda.jsx';
import Clock from './Clock.jsx';
import Weather from './Weather.jsx';
import WeatherScreen from './WeatherScreen.jsx';
import MonthCalendar from './MonthCalendar.jsx';
import QuickAddEvent from './QuickAddEvent.jsx';
import Quote from './Quote.jsx';
import AlertBanner from './AlertBanner.jsx';
import { quoteForDay } from '../lib/quotes.js';
import { todayKey } from '../lib/dates.js';

// Data refresh, not page reload — the slideshow keeps its place. Cheap against
// the LAN server; note that external .ics feeds still only change as often as
// the server polls them (feed_poll_minutes).
const PLAYLIST_REFRESH_MS = 15 * 1000;
const AGENDA_REFRESH_MS = 15 * 1000;
const SETTINGS_REFRESH_MS = 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const WEATHER_REFRESH_MS = 5 * 60 * 1000; // the server caches; this just reads it

/** Stable per-screen id so the admin page can tell frames apart. */
function getDeviceId() {
  try {
    let id = localStorage.getItem('frame.deviceId');
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      localStorage.setItem('frame.deviceId', id);
    }
    return id;
  } catch {
    return null; // private browsing — heartbeats are skipped
  }
}

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

  // The month grid needs a wider window than the sidebar agenda: back to the
  // start of last month, forward far enough to page ahead a few months.
  const monthQuery = usePolled(
    async () => {
      const from = new Date();
      from.setMonth(from.getMonth() - 1, 1);
      return (
        await api.get(`/events/agenda?days=200&from=${from.toISOString().slice(0, 10)}`)
      ).events;
    },
    AGENDA_REFRESH_MS,
    [token]
  );

  const playlistQuery = usePolled(
    async () => (await api.get('/photos/playlist')).photos,
    PLAYLIST_REFRESH_MS,
    [token]
  );

  // Re-fetch when the admin moves the location so it lands within one settings
  // poll rather than up to five minutes later.
  const weatherQuery = usePolled(async () => api.get('/weather'), WEATHER_REFRESH_MS, [
    token,
    settings?.weather_latitude,
    settings?.weather_longitude,
    settings?.weather_units,
  ]);

  const [isNight, setIsNight] = useState(false);
  useEffect(() => {
    if (!settings) return;
    const check = () =>
      setIsNight(isNightTime(settings.night_start, settings.night_end));
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [settings]);

  /**
   * Scale every rem-based size at once by moving the root font size. Tailwind's
   * text/spacing scales are rem-based and resolve against <html>, not a parent,
   * so this is the only place that scales the whole display uniformly — and
   * because the sidebar width is in rem too, the panel widens to match.
   */
  const displayScale = Math.min(200, Math.max(50, Number(settings?.display_scale) || 100));
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = `${(16 * displayScale) / 100}px`;
    return () => {
      root.style.fontSize = previous;
    };
  }, [displayScale]);

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

  /**
   * Weather is a transient "look something up" view, not a persisted layout —
   * writing it to localStorage would land the frame on a forecast after a
   * reboot, and the admin can never set it as a default anyway.
   */
  const [weatherView, setWeatherView] = useState(false);
  const [quickAddDate, setQuickAddDate] = useState(null);
  const returnTimerRef = useRef(null);

  const pickLayout = (value) => {
    clearTimeout(returnTimerRef.current);

    if (value === 'weather') {
      setWeatherView(true);
      const minutes = Number(settings?.weather_return_minutes);
      if (Number.isFinite(minutes) && minutes > 0) {
        returnTimerRef.current = setTimeout(() => setWeatherView(false), minutes * 60 * 1000);
      }
      return;
    }

    setWeatherView(false);
    setLocalLayout(value);
    try {
      localStorage.setItem('frame.layout', value);
    } catch {
      /* storage unavailable */
    }
  };

  useEffect(() => () => clearTimeout(returnTimerRef.current), []);

  // Report in every minute so the admin page can show this frame as online.
  const layoutForHeartbeat = weatherView ? 'weather' : localLayout || serverLayout;
  useEffect(() => {
    if (!token) return undefined;
    const deviceId = getDeviceId();
    if (!deviceId) return undefined;

    const beat = () =>
      api
        .post('/displays/heartbeat', {
          deviceId,
          width: window.screen?.width ?? window.innerWidth,
          height: window.screen?.height ?? window.innerHeight,
          layout: layoutForHeartbeat,
        })
        .catch(() => {
          /* offline — the admin page will show it as such */
        });

    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [token, layoutForHeartbeat]);

  /**
   * The day's quote, shown only when the agenda leaves room for it. Measuring
   * accounts for the quote's own height in both states — otherwise showing it
   * would shrink the space that justified showing it, and it would flicker.
   *
   * These hooks must stay above the early returns below: React requires the
   * same hooks in the same order on every render.
   */
  const quote =
    settings?.quotes_enabled === 'true'
      ? quoteForDay(todayKey(settings.timezone), {
          useBuiltIn: settings.quotes_use_builtin === 'true',
          custom: settings.quotes_custom,
        })
      : null;

  const agendaBoxRef = useRef(null);
  const quoteRef = useRef(null);
  const [quoteFits, setQuoteFits] = useState(false);

  useEffect(() => {
    if (!quote) {
      setQuoteFits(false);
      return undefined;
    }
    const measure = () => {
      const box = agendaBoxRef.current;
      const agendaRoot = box?.firstElementChild;
      if (!box || !agendaRoot) return;

      // The agenda stretches to fill its box, so scrollHeight is never less
      // than clientHeight and can't tell us the day is quiet. Sum the day
      // sections instead to get the content's natural height.
      const sections = [...agendaRoot.children];
      const gap = 24; // matches space-y-6
      const contentHeight =
        sections.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0) +
        Math.max(0, sections.length - 1) * gap;

      const quoteHeight = quoteRef.current?.offsetHeight ?? 0;
      // The space the agenda would have if the quote weren't rendered.
      const available = box.clientHeight + quoteHeight;
      const fits = contentHeight + (quoteFits ? 24 : 96) <= available;
      setQuoteFits((prev) => (prev === fits ? prev : fits));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (agendaBoxRef.current) observer.observe(agendaBoxRef.current);
    return () => observer.disconnect();
  }, [quote, quoteFits, agendaQuery.data, settings?.agenda_text_size]);

  const unauthorized =
    settingsQuery.error?.status === 401 || playlistQuery.error?.status === 401;

  if (!token || unauthorized) return <TokenPrompt hasToken={!!token} />;
  if (!settings) return <Splash message="Waking up…" />;

  // Weather is a full-screen view, so it wins over the photo/calendar split.
  const baseLayout = localLayout || serverLayout;
  const layout = weatherView ? 'weather' : baseLayout;
  const showPhotos = !weatherView && baseLayout !== 'calendar-only';
  const showCalendar = !weatherView && baseLayout !== 'photo-only';

  const weatherReady =
    settings.weather_enabled === 'true' && !!settings.weather_latitude;
  const menuItems = LAYOUTS.filter((item) => item.id !== 'weather' || weatherReady);

  const accent = settings.accent_color || '#38bdf8';

  // Decorative bezel: the outer div is the "frame", the inner div is the screen.
  const borderWidth = Math.min(120, Math.max(0, Number(settings.frame_border_width) || 0));
  const borderRadius = Math.min(80, Math.max(0, Number(settings.frame_border_radius) || 0));
  const borderColor = settings.frame_border_color || '#1e293b';

  return (
    <div
      className="kiosk relative h-screen w-screen overflow-hidden"
      style={
        borderWidth > 0
          ? { padding: borderWidth, backgroundColor: borderColor }
          : { backgroundColor: '#020617' }
      }
    >
      <div
        className="relative h-full w-full overflow-hidden bg-slate-950"
        style={borderRadius > 0 ? { borderRadius } : undefined}
      >
      {showPhotos && (
        <PhotoFrame
          photos={playlistQuery.data || []}
          slideSeconds={Number(settings.slide_seconds) || 25}
          transition={settings.transition}
          shuffle={settings.shuffle === 'true'}
          showCaptions={settings.show_captions === 'true'}
          inset={showCalendar}
          fit={settings.photo_fit}
          edgeFadePercent={Number(settings.photo_edge_fade) || 0}
          backdropOpacity={Number(settings.photo_backdrop_opacity) || 0}
          crossfadeMs={Number(settings.photo_crossfade_ms) || 1400}
          kenburnsZoom={Number(settings.kenburns_zoom) || 0}
          sidebarWidthRem={Number(settings.sidebar_width_rem) || 34}
        />
      )}

      {/* Calendar-only becomes a full month grid; alongside photos it stays an
          agenda list, which reads better in a narrow column. */}
      {showCalendar && !showPhotos && (
        <div className="absolute inset-0 z-20 bg-slate-950 p-9 pb-24">
          <MonthCalendar
            events={monthQuery.data || []}
            timezone={settings.timezone}
            clock24={settings.clock_24h === 'true'}
            weekStartsOn={Number(settings.week_starts_on) === 0 ? 0 : 1}
            canAddEvents={settings.frame_add_events === 'true'}
            onAddEvent={setQuickAddDate}
            accent={accent}
            eventsPerDay={Number(settings.month_events_per_day) || 3}
          />
        </div>
      )}

      {showCalendar && showPhotos && (
        <aside
          className="absolute inset-y-0 left-0 z-20 flex max-w-[46vw] flex-col gap-6 p-9 pr-20"
          style={{
            width: `${Number(settings.sidebar_width_rem) || 34}rem`,
            // A long, eased ramp rather than Tailwind's 3-stop gradient — it
            // meets the photo's own edge fade with no visible seam.
            backgroundImage:
              'linear-gradient(to right, rgb(2 6 23) 0%, rgb(2 6 23) 45%, rgba(2,6,23,0.92) 62%, rgba(2,6,23,0.65) 78%, rgba(2,6,23,0.28) 90%, transparent 100%)',
          }}
        >
          {settings.show_clock === 'true' && (
            <Clock
              clock24={settings.clock_24h === 'true'}
              timezone={settings.timezone}
              sizeRem={Number(settings.clock_size_rem) || 5.5}
              showDate={settings.show_date === 'true'}
            />
          )}
          {weatherReady && (
            <Weather
              payload={weatherQuery.data}
              loading={!weatherQuery.data}
              onOpen={() => pickLayout('weather')}
            />
          )}
          <div ref={agendaBoxRef} className="min-h-0 flex-1 overflow-hidden">
            <Agenda
              events={agendaQuery.data || []}
              timezone={settings.timezone}
              clock24={settings.clock_24h === 'true'}
              loading={!agendaQuery.data}
              columns={1}
              textSize={settings.agenda_text_size}
              accent={accent}
              autoFit={settings.auto_fit === 'true'}
              scale={displayScale}
            />
          </div>
          {quoteFits && <Quote ref={quoteRef} quote={quote} accent={accent} />}
        </aside>
      )}

      {quickAddDate && (
        <QuickAddEvent
          dateKey={quickAddDate}
          clock24={settings.clock_24h === 'true'}
          onSaved={() => {
            setQuickAddDate(null);
            monthQuery.reload();
            agendaQuery.reload();
          }}
          onClose={() => setQuickAddDate(null)}
        />
      )}

      {weatherView && <WeatherScreen payload={weatherQuery.data} settings={settings} />}

      <AlertBanner alerts={weatherQuery.data?.weather?.alerts} />

      <LayoutMenu
        layout={layout}
        items={menuItems}
        onPick={pickLayout}
        idleOpacity={Number(settings.menu_idle_opacity) || 30}
        wakeSeconds={Number(settings.menu_wake_seconds) || 6}
        accent={accent}
      />

        <OfflineBadge
          offline={!!(agendaQuery.error || playlistQuery.error || settingsQuery.error)}
        />
      </div>

      {/* Night dimming — outside the screen div so it covers the bezel too;
          a lit border around a dimmed screen looks wrong in a dark room. */}
      <div
        className="pointer-events-none absolute inset-0 z-40 bg-black transition-opacity duration-[3000ms]"
        style={{
          opacity: isNight ? 1 - (Number(settings.night_brightness) || 0.12) : 0,
        }}
      />
    </div>
  );
}

const LAYOUTS = [
  { id: 'calendar-only', label: 'Calendar', icon: CalendarIcon },
  { id: 'sidebar', label: 'Both', icon: SplitIcon },
  { id: 'photo-only', label: 'Photos', icon: PhotoIcon },
  { id: 'weather', label: 'Weather', icon: WeatherMenuIcon },
];

/**
 * Minimal touch menu, bottom-center. Sits dim so it doesn't draw the eye;
 * any touch/click on the screen wakes it to full opacity for a few seconds.
 */
function LayoutMenu({
  layout,
  items = LAYOUTS,
  onPick,
  idleOpacity = 30,
  wakeSeconds = 6,
  accent = '#38bdf8',
}) {
  const [awake, setAwake] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const wake = () => {
      setAwake(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setAwake(false), Math.max(1, wakeSeconds) * 1000);
    };
    window.addEventListener('pointerdown', wake, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', wake);
      clearTimeout(timerRef.current);
    };
  }, [wakeSeconds]);

  return (
    <nav
      aria-label="Display layout"
      className={[
        'absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-full',
        'border border-white/10 bg-slate-950/70 p-1.5 backdrop-blur-md',
        'transition-opacity duration-500',
      ].join(' ')}
      style={{ touchAction: 'manipulation', opacity: awake ? 1 : idleOpacity / 100 }}
    >
      {items.map(({ id, label, icon: Icon }) => {
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
            style={active ? { boxShadow: `inset 0 -2px 0 ${accent}` } : undefined}
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

function WeatherMenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="8.5" cy="8" r="3" />
      <path d="M8.5 2.8v1.2M3.3 8h1.2M4.9 4.4l.9.9M12.1 4.4l-.9.9" />
      <path d="M7 18.5a3.5 3.5 0 0 1 .3-7 5 5 0 0 1 9.4 1.2 3 3 0 0 1-.2 5.8z" />
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
