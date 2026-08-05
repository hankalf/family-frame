/**
 * Weather via Open-Meteo — free, no API key, no signup, so the frame keeps
 * working years from now with no account to maintain.
 *
 * The server polls and caches; every display reads the cached copy. One row in
 * `weather_cache` means the last good reading survives a restart, so the frame
 * shows slightly stale weather instead of a blank panel while the first poll
 * runs (same "stale beats blank" rule as the calendar feeds).
 */
import { db, getSetting, nowIso } from '../db.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FETCH_TIMEOUT_MS = 30_000;

const UNITS = {
  imperial: { temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch' },
  metric: { temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm' },
};

// Our own labels — Open-Meteo reports mph as the awkward "mp/h".
const UNIT_LABELS = {
  imperial: { temp: '°F', wind: 'mph', precip: 'in' },
  metric: { temp: '°C', wind: 'km/h', precip: 'mm' },
};

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'frame-dashboard/1.0' },
    });
    const json = await res.json().catch(() => null);
    // Open-Meteo reports bad input as HTTP 400 with {error:true, reason:"..."} —
    // surface the reason so the admin sees "Latitude must be in range of -90 to
    // 90" instead of a bare "HTTP 400".
    if (json?.error) throw new Error(json.reason || 'Request rejected');
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Trims Open-Meteo's parallel-array response into what the kiosk renders.
 *
 * IMPORTANT: every timestamp here (`time`, `sunrise`, `sunset`) is a *naive*
 * local string like "2026-08-05T04:12" with no UTC offset — it's already in the
 * requested timezone. Never run these through `new Date()`: the server would
 * reinterpret them in its own timezone and shift sunrise by hours. Compare and
 * slice them as strings; the client does the same.
 */
function shapeForecast(raw, unitKey) {
  const currentHour = (raw.current?.time || '').slice(0, 13); // "YYYY-MM-DDTHH"
  const hourly = [];
  const times = raw.hourly?.time || [];
  for (let i = 0; i < times.length && hourly.length < 12; i += 1) {
    // ISO strings in the same timezone sort lexicographically — DST-proof.
    if (currentHour && times[i].slice(0, 13) < currentHour) continue;
    hourly.push({
      time: times[i],
      temp: raw.hourly.temperature_2m?.[i] ?? null,
      code: raw.hourly.weather_code?.[i] ?? null,
      precipChance: raw.hourly.precipitation_probability?.[i] ?? null,
    });
  }

  const daily = (raw.daily?.time || []).map((date, i) => ({
    date,
    code: raw.daily.weather_code?.[i] ?? null,
    high: raw.daily.temperature_2m_max?.[i] ?? null,
    low: raw.daily.temperature_2m_min?.[i] ?? null,
    precipChance: raw.daily.precipitation_probability_max?.[i] ?? null,
    sunrise: raw.daily.sunrise?.[i] ?? null,
    sunset: raw.daily.sunset?.[i] ?? null,
  }));

  return {
    current: {
      temp: raw.current?.temperature_2m ?? null,
      feelsLike: raw.current?.apparent_temperature ?? null,
      humidity: raw.current?.relative_humidity_2m ?? null,
      wind: raw.current?.wind_speed_10m ?? null,
      precipitation: raw.current?.precipitation ?? null,
      code: raw.current?.weather_code ?? null,
      isDay: raw.current?.is_day === 1,
      time: raw.current?.time ?? null,
    },
    hourly,
    daily,
    timezone: raw.timezone,
    unitLabels: UNIT_LABELS[unitKey] || UNIT_LABELS.imperial,
  };
}

/** Exposed for tests — the shaping is where the timestamp contract lives. */
export const shapeForecastForTest = shapeForecast;

/** Fetches and caches once. Returns {ok, error?, skipped?}. */
export async function fetchWeatherNow() {
  if (getSetting('weather_enabled') !== 'true') return { skipped: true, reason: 'Weather is off' };

  const lat = Number(getSetting('weather_latitude'));
  const lon = Number(getSetting('weather_longitude'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
    return { skipped: true, reason: 'No location set' };
  }

  const unitKey = UNITS[getSetting('weather_units')] ? getSetting('weather_units') : 'imperial';
  const units = UNITS[unitKey];
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    // Use the app's timezone, not 'auto', so daily boundaries line up with the
    // clock and agenda — otherwise "today's high" can be yesterday's.
    timezone: getSetting('timezone') || 'auto',
    forecast_days: '7',
    current:
      'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max',
    ...units,
  });

  try {
    const raw = await fetchJson(`${FORECAST_URL}?${params}`);
    const payload = shapeForecast(raw, unitKey);
    db.prepare(
      `INSERT INTO weather_cache (id, payload, fetched_at, last_error)
       VALUES ('current', @payload, @now, NULL)
       ON CONFLICT(id) DO UPDATE SET
         payload = excluded.payload, fetched_at = excluded.fetched_at, last_error = NULL`
    ).run({ payload: JSON.stringify(payload), now: nowIso() });
    return { ok: true };
  } catch (err) {
    const message = err?.message || String(err);
    // Keep the cached payload — stale weather beats an empty panel.
    db.prepare(
      `INSERT INTO weather_cache (id, payload, fetched_at, last_error)
       VALUES ('current', NULL, NULL, @error)
       ON CONFLICT(id) DO UPDATE SET last_error = excluded.last_error`
    ).run({ error: message });
    console.error(`[weather] fetch failed: ${message}`);
    return { ok: false, error: message };
  }
}

export function getCachedWeather() {
  const row = db.prepare("SELECT * FROM weather_cache WHERE id = 'current'").get();
  if (!row) return { weather: null, fetchedAt: null, error: null, stale: false };

  const pollMs = (Math.max(1, Number(getSetting('weather_poll_minutes')) || 15) * 60 * 1000) * 2;
  const fetchedAt = row.fetched_at;
  return {
    weather: row.payload ? JSON.parse(row.payload) : null,
    fetchedAt,
    error: row.last_error,
    stale: fetchedAt ? Date.now() - new Date(fetchedAt).getTime() > pollMs : false,
  };
}

/** Admin city search for the settings picker. */
export async function searchPlaces(query) {
  const params = new URLSearchParams({ name: query, count: '5', language: 'en', format: 'json' });
  const data = await fetchJson(`${GEOCODE_URL}?${params}`);
  return (data.results || []).map((r) => ({
    name: r.name,
    admin1: r.admin1 || null,
    country: r.country || null,
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

let timer = null;

export function startWeatherPolling() {
  const run = async () => {
    const result = await fetchWeatherNow().catch((err) => {
      console.error('[weather]', err);
      return { ok: false };
    });
    // Floor of 5 min: Open-Meteo's free tier is a courtesy and there's no
    // benefit to polling faster. Retry sooner while we have nothing to show.
    const minutes = Math.max(5, Number(getSetting('weather_poll_minutes')) || 15);
    const wait = result?.ok || getCachedWeather().weather ? minutes : Math.min(minutes, 2);
    timer = setTimeout(run, wait * 60 * 1000);
    timer.unref?.();
  };
  timer = setTimeout(run, 10_000);
  timer.unref?.();
}

export function stopWeatherPolling() {
  if (timer) clearTimeout(timer);
  timer = null;
}
