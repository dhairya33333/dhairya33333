import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(process.env.ENV_FILE || path.join(ROOT, '.env')); } catch { /* no env file: rely on the real environment (systemd EnvironmentFile) */ }

process.umask(0o077);   // everything this service creates (database, uploads, media) is private to the service user by default

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const port = Number(env.PORT) || 3000;
const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);
const GB = 1024 ** 3;

// Misconfiguration that would silently break or weaken production is a hard stop, not a warning.
if (isProd && !/^https:\/\//.test(env.SITE_URL || '')) {
  console.error('SITE_URL must be the public https:// address in production (payment webhooks, cookies and links depend on it).');
  process.exit(1);
}
if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  console.error('JWT_SECRET must be set to a random string of 32+ characters in production.');
  process.exit(1);
}

const dataDir = path.resolve(env.DATA_DIR || path.join(ROOT, 'data'));
const pick = (name, fallback) => path.resolve(env[name] || fallback);

// Each can be moved to its own volume with an env var; defaults keep everything under DATA_DIR.
export const dirs = {
  data: dataDir,
  uploads: path.join(dataDir, 'uploads'),                        // public: posters, trailers, feed thumbnails
  incoming: pick('INCOMING_DIR', path.join(dataDir, 'incoming')), // drop big files here via SFTP, then import from admin
  source: pick('SOURCE_DIR', path.join(dataDir, 'private', 'source')),  // ORIGINAL movies. Never served, never auto-deleted
  tmp: pick('UPLOAD_TMP_DIR', path.join(dataDir, 'private', 'tmp')),    // partial uploads
  media: pick('MEDIA_DIR', path.join(dataDir, 'private', 'media')),     // processed HLS, served only through the gated route
  backups: pick('BACKUP_DIR', path.join(dataDir, 'backups')),
};
for (const [name, d] of Object.entries(dirs)) {
  // the incoming folder is group-writable so the person using SFTP (same group) can drop files in; nothing else is shared
  fs.mkdirSync(d, { recursive: true, mode: name === 'incoming' ? 0o770 : 0o700 });
  // chmod is not subject to the umask, so it is what actually applies the intended modes
  try { fs.chmodSync(d, name === 'incoming' ? 0o770 : 0o700); } catch { /* not ours to change */ }
}

const provider = (env.PAYMENT_PROVIDER || 'razorpay').toLowerCase();
const razorpay = { keyId: env.RAZORPAY_KEY_ID || '', keySecret: env.RAZORPAY_KEY_SECRET || '', webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '' };
const cashfree = {
  appId: env.CASHFREE_APP_ID || '', secret: env.CASHFREE_SECRET_KEY || '',
  base: env.CASHFREE_ENV === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg',
  sdkMode: env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox', version: '2023-08-01',
};
const configured = provider === 'razorpay' ? !!(razorpay.keyId && razorpay.keySecret && razorpay.webhookSecret)
  : provider === 'cashfree' ? !!(cashfree.appId && cashfree.secret) : false;

export const config = {
  port,
  isProd,
  siteUrl: (env.SITE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  sessionDays: num(env.SESSION_DAYS, 14),
  // A malformed Client ID would fail confusingly at sign-in time, so reject it up front and leave Google sign-in off.
  google: (() => {
    const id = (env.GOOGLE_CLIENT_ID || '').trim();
    if (id && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) { console.error('GOOGLE_CLIENT_ID is not a valid Google OAuth client id (expected ...apps.googleusercontent.com). Google sign-in is disabled.'); return { clientId: '', invalid: true }; }
    return { clientId: id, invalid: false };
  })(),
  paymentProvider: provider,
  razorpay,
  cashfree,
  // provider name when configured, "demo" locally without keys (simulated, never in production), else "unconfigured"
  paymentsMode: configured ? provider : (isProd ? 'unconfigured' : 'demo'),
  rate: { auth: num(env.RATE_LIMIT_AUTH, 30), payments: num(env.RATE_LIMIT_PAYMENTS, 20), api: num(env.RATE_LIMIT_API, 1500), contact: num(env.RATE_LIMIT_CONTACT, 5) },   // requests per 15 min per IP
  limits: {
    maxUploadBytes: num(env.MAX_UPLOAD_BYTES, 16 * GB),   // 10.8 GB source fits with headroom
    chunkBytes: num(env.UPLOAD_CHUNK_BYTES, 32 * 1024 * 1024),
    reserveFreeBytes: num(env.MIN_FREE_BYTES, 5 * GB),     // always keep this much disk free
    staleUploadDays: num(env.STALE_UPLOAD_DAYS, 7),
  },
  encode: {
    concurrency: Math.max(1, num(env.ENCODE_CONCURRENCY, 1)),
    threads: num(env.FFMPEG_THREADS, 0),                  // 0 = ffmpeg decides
    preset: env.FFMPEG_PRESET || 'veryfast',
    height: num(env.HLS_HEIGHT, 720),
    crf: num(env.HLS_CRF, 22),
    maxrateKbps: num(env.HLS_MAXRATE_KBPS, 3500),         // caps bitrate spikes so bandwidth/size are predictable
    segment: num(env.HLS_SEGMENT_SECONDS, 6),
    estVideoKbps: num(env.HLS_EST_VIDEO_KBPS, 2500),      // only used for the pre-encode size estimate
    speedX: num(env.ENCODE_SPEED_X, 1),                   // assumed realtime multiple for the time estimate
    nice: env.FFMPEG_NICE !== '0',
    timeoutHours: num(env.ENCODE_TIMEOUT_HOURS, 12),         // a stuck ffmpeg is killed after this long
  },
};
