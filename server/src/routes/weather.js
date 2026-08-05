import express from 'express';
import { getSetting } from '../db.js';
import { requireAdmin, requireViewer } from '../auth.js';
import { fetchWeatherNow, getCachedWeather, searchPlaces } from '../services/weather.js';

export const router = express.Router();

router.get('/', requireViewer, (_req, res) => {
  const cached = getCachedWeather();
  res.json({
    ...cached,
    enabled: getSetting('weather_enabled') === 'true',
    label: getSetting('weather_label'),
    units: getSetting('weather_units'),
  });
});

/**
 * City search for the admin location picker. Proxied through the server so the
 * companion app works even when only the server has outbound internet.
 */
router.get('/search', requireAdmin, async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) return res.status(400).json({ error: 'Type at least two characters' });

  try {
    res.json({ results: await searchPlaces(query) });
  } catch (err) {
    res.status(502).json({ error: `Location search failed: ${err.message}` });
  }
});

router.post('/refresh', requireAdmin, async (_req, res) => {
  const result = await fetchWeatherNow();
  res.json({ ...result, ...getCachedWeather() });
});
