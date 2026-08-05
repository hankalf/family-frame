import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { WEB_DIST, ensureDirs } from './paths.js';
import { attachIdentity } from './auth.js';
import { getDisplayToken } from './db.js';
import { router as authRoutes } from './routes/auth.js';
import { router as userRoutes, inviteRouter, meRouter } from './routes/users.js';
import { router as eventRoutes } from './routes/events.js';
import { router as photoRoutes } from './routes/photos.js';
import { router as settingRoutes, feedRouter } from './routes/settings.js';
import { startFeedPolling } from './services/ics.js';
import { startFolderScanning } from './services/photoSources.js';

ensureDirs();

const PORT = Number(process.env.PORT) || 4000;
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

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
app.use((err, _req, res, _next) => {
  console.error('[server]', err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
});

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Frame dashboard server listening on http://0.0.0.0:${PORT}`);
  console.log(`  Display token: ${getDisplayToken()}`);
  console.log(`  Kiosk URL:     http://<this-machine>:${PORT}/display?token=${getDisplayToken()}\n`);
  startFeedPolling();
  startFolderScanning();
});
