import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env, rely on real env */ }

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const port = Number(env.PORT) || 3000;

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  console.error('JWT_SECRET must be set to a random string of 32+ characters in production.');
  process.exit(1);
}

const dataDir = path.resolve(env.DATA_DIR || path.join(ROOT, 'data'));
export const dirs = {
  data: dataDir,
  uploads: path.join(dataDir, 'uploads'),     // public images / trailers
  incoming: path.join(dataDir, 'incoming'),   // drop big files here via scp/sftp, then import from admin
  source: path.join(dataDir, 'private', 'source'),
  tmp: path.join(dataDir, 'private', 'tmp'),
  media: path.join(dataDir, 'private', 'media'), // HLS output, served only through the gated route
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

const hasCashfree = Boolean(env.CASHFREE_APP_ID && env.CASHFREE_SECRET_KEY);

export const config = {
  port,
  isProd,
  siteUrl: (env.SITE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  cashfree: {
    appId: env.CASHFREE_APP_ID || '',
    secret: env.CASHFREE_SECRET_KEY || '',
    base: env.CASHFREE_ENV === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg',
    sdkMode: env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox',
    version: '2023-08-01',
  },
  // "demo" lets you click through the purchase flow locally with no gateway keys. Never active in production.
  paymentsMode: hasCashfree ? 'cashfree' : (isProd ? 'unconfigured' : 'demo'),
  hls: { height: Number(env.HLS_HEIGHT) || 720, crf: Number(env.HLS_CRF) || 22, segment: 6 },
};
