import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { WEB_DIST, ensureDirs } from './paths.js';
import { attachIdentity } from './auth.js';
import { router as authRoutes } from './routes/auth.js';
import { router as userRoutes, inviteRouter, meRouter } from './routes/users.js';
import { router as eventRoutes } from './routes/events.js';
import { router as photoRoutes } from './routes/photos.js';
import { router as settingRoutes, feedRouter } from './routes/settings.js';
import { router as ingestRoutes } from './routes/ingest.js';
import { router as displayRoutes } from './routes/displays.js';
import { router as weatherRoutes } from './routes/weather.js';
import { router as backupRoutes } from './routes/backups.js';
import { router as healthRoutes } from './routes/health.js';

/**
 * Builds the Express app without binding a port, so tests can drive the real
 * API in-process. index.js adds listening and the background services.
 */
export function createApp({ serveWeb = true } = {}) {
  ensureDirs();

  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(attachIdentity);

  app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/invites', inviteRouter);
  app.use('/api/me', meRouter);
  app.use('/api/events', eventRoutes);
  app.use('/api/photos', photoRoutes);
  app.use('/api/settings', settingRoutes);
  app.use('/api/feeds', feedRouter);
  app.use('/api/ingest', ingestRoutes);
  app.use('/api/displays', displayRoutes);
  app.use('/api/weather', weatherRoutes);
  app.use('/api/backups', backupRoutes);
  app.use('/api/system', healthRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

  // eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
  app.use((err, _req, res, _next) => {
    console.error('[server]', err);
    res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
  });

  if (!serveWeb) return app;

  // In production the built SPA is served from the same origin, so the Pi only
  // needs one port open and there's no CORS to configure.
  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  } else {
    app.get('*', (_req, res) =>
      res
        .status(503)
        .type('text/plain')
        .send('Web app not built yet. Run `npm run build`, or use `npm run dev` for development.')
    );
  }

  return app;
}
