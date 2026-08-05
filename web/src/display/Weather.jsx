import WeatherIcon from './WeatherIcons.jsx';
import { describeWeather, formatTemp } from '../lib/weatherCodes.js';

/**
 * Compact current-conditions widget for the kiosk sidebar. Tapping it opens the
 * full weather view.
 *
 * `shrink-0` is load-bearing: the sidebar is a flex column and Agenda is
 * `flex-1`, so without it a busy day would squash the widget to nothing.
 */
export default function Weather({ payload, loading, onOpen }) {
  if (loading) {
    return <div className="h-20 shrink-0 animate-pulse rounded-2xl bg-slate-800/40" />;
  }

  const weather = payload?.weather;
  if (!weather?.current) return null;

  const { current, daily } = weather;
  const { label, icon } = describeWeather(current.code, current.isDay);
  const today = daily?.[0];

  return (
    <button
      onClick={onOpen}
      className="shrink-0 flex w-full items-center gap-4 rounded-2xl p-1 text-left transition active:bg-white/5"
      aria-label="Show the full forecast"
    >
      <WeatherIcon icon={icon} size={56} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-5xl font-semibold tabular-nums leading-none text-white">
            {formatTemp(current.temp)}
          </span>
          <span className="truncate text-lg text-slate-300">{label}</span>
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-base text-slate-400">
          {today && (
            <span className="tabular-nums">
              H {formatTemp(today.high)} · L {formatTemp(today.low)}
            </span>
          )}
          {payload?.label && (
            <>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="truncate">{payload.label}</span>
            </>
          )}
        </p>
      </div>
    </button>
  );
}
