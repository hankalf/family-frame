import { createApp } from './app.js';
import { getDisplayToken } from './db.js';
import { startFeedPolling } from './services/ics.js';
import { startFolderScanning } from './services/photoSources.js';
import { startImapPolling } from './services/inbox.js';
import { startWeatherPolling } from './services/weather.js';
import { startBackupSchedule } from './services/backup.js';
import { startHealthMonitoring } from './services/health.js';

const PORT = Number(process.env.PORT) || 4000;
const app = createApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Frame dashboard server listening on http://0.0.0.0:${PORT}`);
  console.log(`  Display token: ${getDisplayToken()}`);
  console.log(`  Kiosk URL:     http://<this-machine>:${PORT}/display?token=${getDisplayToken()}\n`);
  startFeedPolling();
  startFolderScanning();
  startImapPolling();
  startWeatherPolling();
  startBackupSchedule();
  startHealthMonitoring();
});
