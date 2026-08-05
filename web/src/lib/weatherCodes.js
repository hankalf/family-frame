/**
 * WMO weather codes (what Open-Meteo returns) → a label and an icon key.
 * Icons are inline SVG components so the frame renders correctly with no
 * internet — see display/WeatherIcons.jsx.
 */

const CODES = {
  0: { label: 'Clear', icon: 'clear' },
  1: { label: 'Mainly clear', icon: 'clear' },
  2: { label: 'Partly cloudy', icon: 'partly' },
  3: { label: 'Overcast', icon: 'cloud' },
  45: { label: 'Fog', icon: 'fog' },
  48: { label: 'Freezing fog', icon: 'fog' },
  51: { label: 'Light drizzle', icon: 'drizzle' },
  53: { label: 'Drizzle', icon: 'drizzle' },
  55: { label: 'Heavy drizzle', icon: 'drizzle' },
  56: { label: 'Freezing drizzle', icon: 'sleet' },
  57: { label: 'Freezing drizzle', icon: 'sleet' },
  61: { label: 'Light rain', icon: 'rain' },
  63: { label: 'Rain', icon: 'rain' },
  65: { label: 'Heavy rain', icon: 'rain' },
  66: { label: 'Freezing rain', icon: 'sleet' },
  67: { label: 'Freezing rain', icon: 'sleet' },
  71: { label: 'Light snow', icon: 'snow' },
  73: { label: 'Snow', icon: 'snow' },
  75: { label: 'Heavy snow', icon: 'snow' },
  77: { label: 'Snow grains', icon: 'snow' },
  80: { label: 'Light showers', icon: 'rain' },
  81: { label: 'Showers', icon: 'rain' },
  82: { label: 'Heavy showers', icon: 'rain' },
  85: { label: 'Snow showers', icon: 'snow' },
  86: { label: 'Heavy snow showers', icon: 'snow' },
  95: { label: 'Thunderstorm', icon: 'thunder' },
  96: { label: 'Thunderstorm, hail', icon: 'thunder' },
  99: { label: 'Thunderstorm, hail', icon: 'thunder' },
};

/** Returns { label, icon }. `isDay` picks the night variant where one exists. */
export function describeWeather(code, isDay = true) {
  const entry = CODES[code] ?? { label: '—', icon: 'cloud' };
  if (!isDay && (entry.icon === 'clear' || entry.icon === 'partly')) {
    return { ...entry, icon: entry.icon === 'clear' ? 'clearNight' : 'partlyNight' };
  }
  return entry;
}

/** Rounded temperature with the degree sign; em dash when unavailable. */
export function formatTemp(value) {
  return Number.isFinite(value) ? `${Math.round(value)}°` : '—';
}

/** "Today" / "Tomorrow" / weekday name for a YYYY-MM-DD forecast date. */
export function formatDayName(date, index) {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    timeZone: 'UTC',
  });
}
