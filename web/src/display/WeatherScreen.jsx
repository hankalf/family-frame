import { Suspense, lazy } from 'react';
import WeatherIcon from './WeatherIcons.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import RadarUnavailable from './RadarUnavailable.jsx';
import { describeWeather, formatDayName, formatTemp } from '../lib/weatherCodes.js';

// Leaflet is ~42KB gzipped — keep it out of the kiosk's boot bundle and fetch
// it from the LAN server only when someone opens the weather view.
const RadarMap = lazy(() => import('./RadarMap.jsx'));

/** Open-Meteo times are naive local strings — slice, never `new Date()`. */
const hourLabel = (time, clock24) => {
  const hour = Number(time.slice(11, 13));
  if (clock24) return `${String(hour).padStart(2, '0')}`;
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
};

const timeLabel = (time, clock24) => {
  if (!time) return '—';
  const hour = Number(time.slice(11, 13));
  const minute = time.slice(14, 16);
  if (clock24) return `${String(hour).padStart(2, '0')}:${minute}`;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${minute} ${suffix}`;
};

export default function WeatherScreen({ payload, settings }) {
  const weather = payload?.weather;
  const clock24 = settings.clock_24h === 'true';
  const radarEnabled = settings.weather_radar_enabled === 'true';
  const lat = Number(settings.weather_latitude);
  const lon = Number(settings.weather_longitude);
  const canRadar =
    radarEnabled && Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);

  if (!weather?.current) {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950 p-9 pb-24">
        <div className="text-center">
          <p className="text-2xl text-slate-400">Weather isn't set up yet</p>
          <p className="mt-2 text-slate-600">
            Pick a location in the family app under Admin → Display.
          </p>
        </div>
      </div>
    );
  }

  const { current, hourly, daily, unitLabels } = weather;
  const { label, icon } = describeWeather(current.code, current.isDay);
  const today = daily?.[0];

  return (
    <div className="absolute inset-0 z-20 overflow-hidden bg-slate-950 p-9 pb-24">
      <div className={`grid h-full gap-8 ${canRadar ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <div className="flex min-w-0 flex-col gap-7 overflow-hidden">
          {/* Current conditions */}
          <section className="shrink-0">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">
              {payload.label || 'Now'}
              {payload.stale && <span className="ml-2 text-amber-400/80">· last known</span>}
            </h2>
            <div className="flex items-center gap-6">
              <WeatherIcon icon={icon} size={112} className="shrink-0" />
              <div className="min-w-0">
                <div className="text-[6rem] font-semibold leading-none tracking-tight tabular-nums text-white">
                  {formatTemp(current.temp)}
                </div>
                <p className="mt-2 text-3xl font-light text-slate-300">{label}</p>
              </div>
            </div>

            <dl className="mt-6 grid grid-cols-3 gap-x-6 gap-y-4">
              <Stat label="Feels like" value={formatTemp(current.feelsLike)} />
              <Stat
                label="Humidity"
                value={current.humidity != null ? `${Math.round(current.humidity)}%` : '—'}
              />
              <Stat
                label="Wind"
                value={
                  current.wind != null
                    ? `${Math.round(current.wind)} ${unitLabels?.wind || ''}`.trim()
                    : '—'
                }
              />
              <Stat
                label="Rain chance"
                value={today?.precipChance != null ? `${today.precipChance}%` : '—'}
              />
              <Stat label="Sunrise" value={timeLabel(today?.sunrise, clock24)} />
              <Stat label="Sunset" value={timeLabel(today?.sunset, clock24)} />
            </dl>
          </section>

          {/* Next 12 hours */}
          {hourly?.length > 0 && (
            <section className="shrink-0">
              <h2 className="mb-2.5 text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">
                Next 12 hours
              </h2>
              <div className="grid grid-flow-col auto-cols-fr gap-1">
                {hourly.map((hour) => {
                  const hourIcon = describeWeather(hour.code, true).icon;
                  return (
                    <div
                      key={hour.time}
                      className="flex flex-col items-center gap-1 rounded-xl py-2"
                    >
                      <span className="text-sm tabular-nums text-slate-400">
                        {hourLabel(hour.time, clock24)}
                      </span>
                      <WeatherIcon icon={hourIcon} size={26} />
                      <span className="text-lg font-medium tabular-nums text-slate-100">
                        {formatTemp(hour.temp)}
                      </span>
                      <span className="h-4 text-xs tabular-nums text-sky-400">
                        {hour.precipChance > 10 ? `${hour.precipChance}%` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 7-day */}
          {daily?.length > 0 && (
            <section className="min-h-0 flex-1 overflow-hidden">
              <h2 className="mb-2.5 text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">
                This week
              </h2>
              <ul className="space-y-1.5">
                {daily.map((day, index) => {
                  const dayIcon = describeWeather(day.code, true).icon;
                  return (
                    <li key={day.date} className="flex items-center gap-4">
                      <span
                        className={[
                          'w-32 shrink-0 text-lg',
                          index === 0 ? 'font-medium text-sky-400' : 'text-slate-300',
                        ].join(' ')}
                      >
                        {formatDayName(day.date, index)}
                      </span>
                      <WeatherIcon icon={dayIcon} size={28} className="shrink-0" />
                      <span className="w-14 shrink-0 text-base tabular-nums text-sky-400">
                        {day.precipChance > 10 ? `${day.precipChance}%` : ''}
                      </span>
                      <span className="ml-auto text-lg tabular-nums text-slate-500">
                        {formatTemp(day.low)}
                      </span>
                      <span className="w-16 text-right text-lg font-medium tabular-nums text-slate-100">
                        {formatTemp(day.high)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        {canRadar && (
          <section className="flex min-w-0 flex-col overflow-hidden">
            <h2 className="mb-2.5 shrink-0 text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">
              Radar
            </h2>
            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl ring-1 ring-white/10">
              {/* Leaflet mutates the DOM directly and can throw on odd container
                  states — an unhandled throw here would blank the whole wall. */}
              <ErrorBoundary fallback={<RadarUnavailable message="Radar failed to load" />}>
                <Suspense fallback={<RadarLoading />}>
                  <RadarMap latitude={lat} longitude={lon} timezone={settings.timezone} />
                </Suspense>
              </ErrorBoundary>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-base text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-2xl tabular-nums text-slate-100">{value}</dd>
    </div>
  );
}

function RadarLoading() {
  return <div className="h-full w-full animate-pulse bg-slate-800/40" />;
}
