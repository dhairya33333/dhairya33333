import { config } from './config.js';
import { createApp, runStartupTasks } from './app.js';
import { startInstagramScheduler } from './instagram.js';
import { cleanupStaleUploads } from './transcode.js';
import { purgeRevoked } from './auth.js';

runStartupTasks();
startInstagramScheduler();
setInterval(() => { cleanupStaleUploads(); purgeRevoked(); }, 6 * 3600_000);

const server = createApp().listen(config.port, () =>
  console.log(`Portfolio running on ${config.siteUrl}  (payments: ${config.paymentsMode}, google: ${config.google.clientId ? 'on' : 'off'})`));
server.requestTimeout = 0;            // chunk uploads and long downloads must not hit Node's default request timeout
server.headersTimeout = 65_000;
process.on('SIGTERM', () => server.close(() => process.exit(0)));
